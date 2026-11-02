import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from } }));

import { SupabaseAuditLogRepository } from "./SupabaseAuditLogRepository";

/** PostgREST のクエリビルダーの代わり。呼ばれた操作を記録し、await すると result になる。 */
function query(result: { data: unknown; error: unknown }) {
	const calls: [string, unknown[]][] = [];
	const builder = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
	for (const name of ["select", "order", "limit", "lt", "gte", "in", "eq", "or"]) {
		builder[name] = (...args: unknown[]) => {
			calls.push([name, args]);
			return builder;
		};
	}
	db.from.mockReturnValueOnce(builder);
	return calls;
}
const names = (calls: [string, unknown[]][]) => calls.map(([name]) => name);
const row = (id: number) => ({
	id,
	occurred_at: "2026-11-02T05:03:00+00:00",
	actor_user_id: "u-1",
	action: "sheet.status",
	entity_id: 100,
	details: { from: "draft", to: "goals_submitted" },
});
beforeEach(() => db.from.mockReset());

describe("findPage", () => {
	it("reads the newest records first and asks for one extra to know whether more remain", async () => {
		const calls = query({ data: [row(9), row(8), row(7)], error: null });
		const page = await new SupabaseAuditLogRepository().findPage({}, null, 2);

		expect(db.from).toHaveBeenCalledWith("security_audit_log");
		expect(calls).toContainEqual(["order", ["id", { ascending: false }]]);
		expect(calls).toContainEqual(["limit", [3]]);
		expect(names(calls)).not.toContain("lt");
		expect(page).toEqual({
			hasMore: true,
			records: [9, 8].map((id) => ({
				id,
				occurredAt: "2026-11-02T05:03:00+00:00",
				actorUserId: "u-1",
				action: "sheet.status",
				entityId: 100,
				details: { from: "draft", to: "goals_submitted" },
			})),
		});
	});

	it("continues below the last record of the previous page, and reports the end", async () => {
		const calls = query({ data: [row(4)], error: null });
		const page = await new SupabaseAuditLogRepository().findPage({}, 5, 2);
		expect(calls).toContainEqual(["lt", ["id", 5]]);
		expect(page.hasMore).toBe(false);
	});

	it("narrows by kind, time range and the account that acted", async () => {
		const calls = query({ data: [], error: null });
		await new SupabaseAuditLogRepository().findPage(
			{
				actions: ["sheet.corrected", "sheet.privileged_delete"],
				since: "2026-10-31T15:00:00.000Z",
				until: "2026-11-02T15:00:00.000Z",
				actorUserId: "u-1",
			},
			null,
			50,
		);
		expect(calls).toContainEqual([
			"in",
			["action", ["sheet.corrected", "sheet.privileged_delete"]],
		]);
		expect(calls).toContainEqual(["gte", ["occurred_at", "2026-10-31T15:00:00.000Z"]]);
		expect(calls).toContainEqual(["lt", ["occurred_at", "2026-11-02T15:00:00.000Z"]]);
		expect(calls).toContainEqual(["eq", ["actor_user_id", "u-1"]]);
	});

	it("finds an employee's own records, their sheets' records and records of their deleted sheets", async () => {
		const calls = query({ data: [], error: null });
		await new SupabaseAuditLogRepository().findPage(
			{ target: { employeeId: 7, sheetIds: [100, 101] } },
			null,
			50,
		);
		expect(calls).toContainEqual([
			"or",
			[
				"and(action.like.employee.*,entity_id.eq.7),and(action.like.sheet.*,entity_id.in.(100,101)),details->>employeeId.eq.7",
			],
		]);
	});

	it("leaves out the sheet clause for an employee who has no sheets", async () => {
		const calls = query({ data: [], error: null });
		await new SupabaseAuditLogRepository().findPage(
			{ target: { employeeId: 7, sheetIds: [] } },
			null,
			50,
		);
		expect(calls).toContainEqual([
			"or",
			["and(action.like.employee.*,entity_id.eq.7),details->>employeeId.eq.7"],
		]);
	});

	it("does not query with an empty list of kinds, which would mean every kind", async () => {
		const calls = query({ data: [], error: null });
		await new SupabaseAuditLogRepository().findPage({ actions: [] }, null, 50);
		expect(names(calls)).not.toContain("in");
	});

	it.each([
		[0, "a page size of zero"],
		[201, "a page size above the limit"],
		[1.5, "a fractional page size"],
	])("refuses %s (%s) before asking the database", async (limit) => {
		await expect(new SupabaseAuditLogRepository().findPage({}, null, limit)).rejects.toThrow();
		expect(db.from).not.toHaveBeenCalled();
	});

	it("passes a database error on instead of showing an empty log", async () => {
		query({ data: null, error: { message: "permission denied", code: "42501" } });
		await expect(new SupabaseAuditLogRepository().findPage({}, null, 50)).rejects.toMatchObject({
			code: "42501",
		});
	});

	it("treats a record without details as having none", async () => {
		query({ data: [{ ...row(1), details: null }], error: null });
		const page = await new SupabaseAuditLogRepository().findPage({}, null, 50);
		expect(page.records[0].details).toEqual({});
	});
});

it("reads every employee with the account they are linked to", async () => {
	const calls = query({
		data: [
			{ id: 4, user_id: "u-4", name: "山田 花子", employee_no: "E4" },
			{ id: 7, user_id: null, name: "佐藤 一郎", employee_no: "E7" },
		],
		error: null,
	});
	expect(await new SupabaseAuditLogRepository().findPeople()).toEqual([
		{ id: 4, userId: "u-4", name: "山田 花子", employeeNo: "E4" },
		{ id: 7, userId: null, name: "佐藤 一郎", employeeNo: "E7" },
	]);
	expect(db.from).toHaveBeenCalledWith("employees");
	expect(calls).toContainEqual(["select", ["id, user_id, name, employee_no"]]);
});

it("reads the role names by ID", async () => {
	query({
		data: [
			{ id: 1, role_name: "Employee" },
			{ id: 3, role_name: "Admin" },
		],
		error: null,
	});
	expect(await new SupabaseAuditLogRepository().findRoleNames()).toEqual(
		new Map([
			[1, "Employee"],
			[3, "Admin"],
		]),
	);
	expect(db.from).toHaveBeenCalledWith("roles");
});

it.each(["findPeople", "findRoleNames"] as const)("%s passes a database error on", async (name) => {
	query({ data: null, error: new Error("offline") });
	await expect(new SupabaseAuditLogRepository()[name]()).rejects.toThrow("offline");
});
