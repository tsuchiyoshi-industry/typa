import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from } }));

import { SupabaseNotificationInboxRepository } from "./SupabaseNotificationInboxRepository";

/** PostgREST のクエリビルダーの代わり。呼ばれた操作を記録し、await すると result になる。 */
function query(result: { data: unknown; error: unknown }) {
	const calls: [string, unknown[]][] = [];
	const builder = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
	for (const name of ["select", "update", "order", "limit", "in", "is"]) {
		builder[name] = (...args: unknown[]) => {
			calls.push([name, args]);
			return builder;
		};
	}
	db.from.mockReturnValueOnce(builder);
	return calls;
}
beforeEach(() => db.from.mockReset());

it("reads the newest notices first, as the app names them", async () => {
	const calls = query({
		data: [
			{
				id: 7,
				sheet_id: 100,
				kind: "first_evaluated",
				employee_name: "山田 太郎",
				period_name: "2026年度 上期",
				created_at: "2026-10-23T05:00:00Z",
				read_at: null,
			},
		],
		error: null,
	});
	expect(await new SupabaseNotificationInboxRepository().findMine()).toEqual([
		{
			id: 7,
			sheetId: 100,
			kind: "first_evaluated",
			employeeName: "山田 太郎",
			periodName: "2026年度 上期",
			createdAt: "2026-10-23T05:00:00Z",
			read: false,
		},
	]);
	expect(db.from).toHaveBeenCalledWith("notifications");
	expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
	expect(calls.find(([name]) => name === "limit")?.[1][0]).toBeGreaterThan(0);
});

it("does not mistake a failed read for an empty inbox", async () => {
	query({ data: null, error: new Error("offline") });
	await expect(new SupabaseNotificationInboxRepository().findMine()).rejects.toThrow("offline");
});

it("marks the chosen notices read, and asks nothing for an empty choice", async () => {
	const repository = new SupabaseNotificationInboxRepository();
	await repository.markRead([]);
	expect(db.from).not.toHaveBeenCalled();
	const calls = query({ data: null, error: null });
	await repository.markRead([7, 8]);
	const update = calls.find(([name]) => name === "update")?.[1][0] as { read_at: string };
	expect(Number.isNaN(Date.parse(update.read_at))).toBe(false);
	expect(calls).toContainEqual(["in", ["id", [7, 8]]]);
});

it("marks every unread notice read at once", async () => {
	const calls = query({ data: null, error: null });
	await new SupabaseNotificationInboxRepository().markAllRead();
	expect(calls.map(([name]) => name)).toContain("update");
	expect(calls).toContainEqual(["is", ["read_at", null]]);
});

it("reports a mark that could not be saved", async () => {
	const repository = new SupabaseNotificationInboxRepository();
	query({ data: null, error: new Error("offline") });
	await expect(repository.markRead([7])).rejects.toThrow("offline");
	query({ data: null, error: new Error("offline") });
	await expect(repository.markAllRead()).rejects.toThrow("offline");
});
