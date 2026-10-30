import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("../db/supabase", () => ({
	supabase: { from: db.from, rpc: db.rpc, auth: { getSession: db.getSession } },
}));

import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { SupabaseEmployeeMasterRepository } from "./SupabaseEmployeeMasterRepository";

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const failed: Result = { data: null, error: { message: "network" } };

/**
 * テーブルごとの結果を返す PostgREST のクエリビルダーの代わり。呼ばれた操作を記録する。
 * maybeSingle(1件だけ引く)は single の結果を返す。
 */
function tables(results: Record<string, Result>, single: Result = ok(null)) {
	const calls: [string, string, unknown[]][] = [];
	db.from.mockImplementation((table: string) => {
		const builder = Promise.resolve(results[table] ?? ok([])) as Promise<Result> &
			Record<string, unknown>;
		for (const name of ["select", "order", "eq", "update"]) {
			builder[name] = (...args: unknown[]) => {
				calls.push([table, name, args]);
				return builder;
			};
		}
		builder.maybeSingle = () => {
			calls.push([table, "maybeSingle", []]);
			return Promise.resolve(single);
		};
		return builder;
	});
	return calls;
}

const employees = [
	{
		id: 1,
		user_id: "u1",
		name: "管理 花子",
		employee_no: "A1",
		role_id: 3,
		career_course: "総合職",
		grade_id: 2,
		primary_evaluator_id: null,
		secondary_evaluator_id: null,
		no_secondary_evaluator: true,
		keep_signed_in: true,
		is_enabled: true,
	},
	{
		id: 2,
		user_id: null,
		name: "社員 太郎",
		employee_no: "E2",
		role_id: 1,
		career_course: "総合職",
		grade_id: null,
		primary_evaluator_id: 1,
		secondary_evaluator_id: null,
		no_secondary_evaluator: false,
		keep_signed_in: false,
		is_enabled: false,
	},
];
const roles = [
	{ id: 1, role_name: "Employee" },
	{ id: 3, role_name: "Admin" },
];
const grades = [{ id: 2, grade_name: "総合職2級" }];
const company = () =>
	tables({ employees: ok(employees), roles: ok(roles), employee_grades: ok(grades) });

beforeEach(() => {
	db.from.mockReset();
	db.rpc.mockReset();
	db.getSession.mockReset();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading the employee master", () => {
	it("names each employee's role, grade and evaluators, telling 'none' from 'not assigned yet'", async () => {
		company();
		const [admin, employee] =
			await new SupabaseEmployeeMasterRepository().findAllEmployeeProfiles();
		expect(admin).toMatchObject({
			employeeNo: "A1",
			role: EmployeeRole.ADMIN,
			gradeName: "総合職2級",
			primaryEvaluatorName: "未設定",
			secondaryEvaluatorName: "なし",
			registered: true,
			keepSignedIn: true,
		});
		expect(employee).toMatchObject({
			employeeNo: "E2",
			role: EmployeeRole.EMPLOYEE,
			gradeName: "未設定",
			primaryEvaluatorName: "管理 花子",
			secondaryEvaluatorName: "未設定",
			registered: false,
			enabled: false,
		});
	});

	// 読めなかったことを「誰もいない」「全員 Employee」「全員の等級が未設定」と見せない(基本設計 12.1)
	it.each([
		["the employees", { employees: failed, roles: ok(roles), employee_grades: ok(grades) }],
		["the roles", { employees: ok(employees), roles: failed, employee_grades: ok(grades) }],
		["the grades", { employees: ok(employees), roles: ok(roles), employee_grades: failed }],
	])("fails instead of guessing when %s cannot be read", async (_label, results) => {
		tables(results);
		const repository = new SupabaseEmployeeMasterRepository();
		await expect(repository.findAllEmployeeProfiles()).rejects.toThrow();
		await expect(repository.findByEmployeeNo("E2")).rejects.toThrow();
	});

	it("lists the grades to choose from, and fails instead of offering none when they cannot be read", async () => {
		tables({ employee_grades: ok(grades) });
		expect(await new SupabaseEmployeeMasterRepository().findGrades()).toEqual([
			{ id: 2, name: "総合職2級" },
		]);
		tables({ employee_grades: failed });
		await expect(new SupabaseEmployeeMasterRepository().findGrades()).rejects.toThrow();
	});
});

describe("the signed-in employee", () => {
	const signedIn = (userId: string | null) =>
		db.getSession.mockResolvedValue({
			data: { session: userId ? { user: { id: userId } } : null },
			error: null,
		});

	it("is nobody without a session, and nobody when the account is not linked yet", async () => {
		signedIn(null);
		expect(await new SupabaseEmployeeMasterRepository().findCurrentEmployeeProfile()).toBeNull();
		signedIn("u9");
		tables({ employees: ok(null) });
		expect(await new SupabaseEmployeeMasterRepository().findCurrentEmployeeProfile()).toBeNull();
	});

	it("reads the profile once for the same account, and again after it changed someone", async () => {
		signedIn("u1");
		const calls = tables(
			{ employees: ok(employees), roles: ok(roles), employee_grades: ok(grades) },
			ok({ id: 1 }),
		);
		const lookups = () => calls.filter(([, name]) => name === "maybeSingle").length;
		const repository = new SupabaseEmployeeMasterRepository();
		expect((await repository.findCurrentEmployeeProfile())?.employeeNo).toBe("A1");
		expect((await repository.findCurrentEmployeeProfile())?.employeeNo).toBe("A1");
		expect(lookups()).toBe(1);
		// 自分の権限を変えたかもしれないので、次は読み直す
		db.rpc.mockResolvedValue(ok(true));
		await repository.updateRoleByEmployeeNo("E2", EmployeeRole.REVIEWER);
		await repository.findCurrentEmployeeProfile();
		expect(lookups()).toBe(2);
	});

	it("is nobody when the employee master cannot be read, and tries again next time", async () => {
		signedIn("u1");
		tables({ employees: failed }, ok({ id: 1 }));
		const repository = new SupabaseEmployeeMasterRepository();
		expect(await repository.findCurrentEmployeeProfile()).toBeNull();
		tables(
			{ employees: ok(employees), roles: ok(roles), employee_grades: ok(grades) },
			ok({ id: 1 }),
		);
		expect((await repository.findCurrentEmployeeProfile())?.employeeNo).toBe("A1");
	});
});

describe("changing an employee", () => {
	it("clears a secondary evaluator as 'none', not as 'not assigned yet'", async () => {
		const calls = company();
		db.from.mockImplementationOnce(() => {
			const builder = Promise.resolve(ok([{ id: 2 }])) as Promise<Result> & Record<string, unknown>;
			for (const name of ["update", "eq", "select"]) {
				builder[name] = (...args: unknown[]) => {
					calls.push(["employees", name, args]);
					return builder;
				};
			}
			return builder;
		});
		await new SupabaseEmployeeMasterRepository().updateEvaluatorByEmployeeNo(
			"E2",
			null,
			"secondary",
		);
		expect(calls).toContainEqual([
			"employees",
			"update",
			[{ secondary_evaluator_id: null, no_secondary_evaluator: true }],
		]);
	});

	it.each([
		["a refused update (no row changed)", ok([])],
		["a failed update", failed],
	])("reports %s as not saved", async (_label, result) => {
		tables({ employees: result });
		expect(
			await new SupabaseEmployeeMasterRepository().updateGradeByEmployeeNo("E2", 2),
		).toBeNull();
	});

	it("does not assign an evaluator it cannot find", async () => {
		company();
		expect(
			await new SupabaseEmployeeMasterRepository().updateEvaluatorByEmployeeNo(
				"E2",
				"X9",
				"primary",
			),
		).toBeNull();
		expect(db.from).not.toHaveBeenCalledWith("employees", expect.anything());
	});

	it.each([
		["updateRoleByEmployeeNo", "set_employee_role", false],
		["resetRegistrationByEmployeeNo", "reset_employee_registration", false],
		["updateEnabledByEmployeeNo", "set_employee_enabled", false],
		["issueInvitationByEmployeeNo", "issue_employee_invitation", null],
		["issuePendingInvitations", "issue_pending_employee_invitations", null],
	] as const)("reports a refused %s (%s) as not done", async (method, rpc, notDone) => {
		db.rpc.mockResolvedValue(failed);
		const repository = new SupabaseEmployeeMasterRepository();
		const run = repository[method] as (...args: unknown[]) => Promise<unknown>;
		expect(await run.call(repository, "E2", EmployeeRole.ADMIN)).toBe(notDone);
		expect(db.rpc).toHaveBeenCalledWith(
			rpc,
			...(rpc.startsWith("issue_pending") ? [] : [expect.anything()]),
		);
	});
});
