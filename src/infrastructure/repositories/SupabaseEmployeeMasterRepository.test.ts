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
 * テーブル・DB 関数ごとの結果を返す PostgREST のクエリビルダーの代わり。呼ばれた操作を記録する。
 */
function tables(results: Record<string, Result>) {
	const calls: [string, string, unknown[]][] = [];
	db.rpc.mockImplementation(async (name: string) => {
		calls.push([name, "rpc", []]);
		return results[name] ?? ok([]);
	});
	db.from.mockImplementation((table: string) => {
		const builder = Promise.resolve(results[table] ?? ok([])) as Promise<Result> &
			Record<string, unknown>;
		for (const name of ["select", "order", "eq", "update"]) {
			builder[name] = (...args: unknown[]) => {
				calls.push([table, name, args]);
				return builder;
			};
		}
		return builder;
	});
	return calls;
}

// 行を見られる人なら誰でも読める列
const employees = [
	{
		id: 1,
		name: "管理 花子",
		employee_no: "A1",
		career_course: "総合職",
		primary_evaluator_id: null,
		secondary_evaluator_id: null,
		no_secondary_evaluator: true,
	},
	{
		id: 2,
		name: "社員 太郎",
		employee_no: "E2",
		career_course: "総合職",
		primary_evaluator_id: 1,
		secondary_evaluator_id: null,
		no_secondary_evaluator: false,
	},
];
// 見る人を限る項目は表から読めず、DB 関数が見てよい分だけ返す(見られない項目は null)
const details = [
	{
		employee_id: 1,
		grade_id: 2,
		role_name: "Admin",
		keep_signed_in: true,
		user_id: "u1",
		registered: true,
		enabled: true,
	},
	{
		employee_id: 2,
		grade_id: null,
		role_name: "Employee",
		keep_signed_in: false,
		user_id: null,
		registered: false,
		enabled: false,
	},
];
const grades = [{ id: 2, grade_name: "総合職2級" }];
const master = {
	employees: ok(employees),
	employee_details: ok(details),
	employee_grades: ok(grades),
	current_employee_id: ok(1),
};
const company = () => tables(master);

beforeEach(() => {
	db.from.mockReset();
	db.rpc.mockReset();
	db.getSession.mockReset();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading the employee master", () => {
	it("names each employee's role, grade and evaluators, telling 'none' from 'not assigned yet'", async () => {
		const calls = company();
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
		// 見る人を限る列は表から読めないので、* でもその列名でも引かない(DB が断る)
		const columns = calls.find(
			([table, name]) => table === "employees" && name === "select",
		)?.[2][0];
		expect(columns).not.toMatch(/\*|grade_id|role_id|keep_signed_in|user_id|is_enabled/);
	});

	it("fills what the reader may not see with the weakest values, not someone else's", async () => {
		tables({ ...master, employee_details: ok([{ ...details[0], employee_id: 9 }]) });
		const [admin] = await new SupabaseEmployeeMasterRepository().findAllEmployeeProfiles();
		expect(admin).toMatchObject({
			role: EmployeeRole.EMPLOYEE,
			gradeId: null,
			gradeName: "未設定",
			registered: false,
			keepSignedIn: false,
		});
	});

	// 読めなかったことを「誰もいない」「全員 Employee」「全員の等級が未設定」と見せない(基本設計 12.1)
	it.each([
		["the employees", { ...master, employees: failed }],
		["their details", { ...master, employee_details: failed }],
		["the grades", { ...master, employee_grades: failed }],
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
		tables({ ...master, current_employee_id: ok(null) });
		expect(await new SupabaseEmployeeMasterRepository().findCurrentEmployeeProfile()).toBeNull();
	});

	it("reads the profile once for the same account, and again after it changed someone", async () => {
		signedIn("u1");
		const calls = company();
		const lookups = () => calls.filter(([name]) => name === "current_employee_id").length;
		const repository = new SupabaseEmployeeMasterRepository();
		expect((await repository.findCurrentEmployeeProfile())?.employeeNo).toBe("A1");
		expect((await repository.findCurrentEmployeeProfile())?.employeeNo).toBe("A1");
		expect(lookups()).toBe(1);
		// 自分の権限を変えたかもしれないので、次は読み直す
		await repository.updateRoleByEmployeeNo("E2", EmployeeRole.REVIEWER);
		await repository.findCurrentEmployeeProfile();
		expect(lookups()).toBe(2);
	});

	it("is nobody when the employee master cannot be read, and tries again next time", async () => {
		signedIn("u1");
		tables({ ...master, employees: failed });
		const repository = new SupabaseEmployeeMasterRepository();
		expect(await repository.findCurrentEmployeeProfile()).toBeNull();
		tables(master);
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
		expect(db.rpc).toHaveBeenCalledWith(rpc, expect.anything());
	});
});

it.each([true, false])("passes bulk invitation mode to the RPC (%s)", async (includeIssued) => {
	db.rpc.mockResolvedValue(ok([]));
	expect(
		await new SupabaseEmployeeMasterRepository().issuePendingInvitations(includeIssued),
	).toEqual([]);
	expect(db.rpc).toHaveBeenCalledWith("issue_pending_employee_invitations", {
		p_include_issued: includeIssued,
	});
});
