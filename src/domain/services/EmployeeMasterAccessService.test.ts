import { describe, expect, it } from "vitest";
import { EmployeeRole } from "../valueObjects/EmployeeRole";
import * as access from "./EmployeeMasterAccessService";

// 基本設計 4.1: 社員マスタ・設定・遡及処理・全社の一覧の操作は、どれも Admin だけ。
// 判定を足したら、ここにも足す(足し忘れると下の「全部を数えた」で落ちる)。
const ADMIN_ONLY = {
	canEditEvaluators: access.canEditEvaluators,
	canEditGrades: access.canEditGrades,
	canEditRoles: access.canEditRoles,
	canEditKeepSignedIn: access.canEditKeepSignedIn,
	canEditSettings: access.canEditSettings,
	canRunSetup: access.canRunSetup,
	canCorrectClosedSheets: access.canCorrectClosedSheets,
	canRunPrivilegedOperations: access.canRunPrivilegedOperations,
	canViewAllSheets: access.canViewAllSheets,
	canResetRegistrations: access.canResetRegistrations,
	canManageEmployeeAccess: access.canManageEmployeeAccess,
	canViewAuditLog: access.canViewAuditLog,
	canViewSecurityAssurance: access.canViewSecurityAssurance,
	canManageGradeMaster: access.canManageGradeMaster,
};

// Admin だけに限らない判定。下の describe で、権限ごとの答えを確かめる
const NOT_ADMIN_ONLY = ["canViewAllEmployees", "canViewEmployeeDetail"];

describe("employee master access", () => {
	it("checks every permission the service offers", () => {
		const offered = Object.keys(access).filter((name) => name.startsWith("can"));
		expect(offered.sort()).toEqual([...Object.keys(ADMIN_ONLY), ...NOT_ADMIN_ONLY].sort());
	});

	describe.each(Object.entries(ADMIN_ONLY))("%s", (_name, allows) => {
		it.each(EmployeeRole.ALL.map((role) => [role.toString(), role] as const))(
			"is %s: only an Admin",
			(_role, role) => {
				expect(allows(role)).toBe(role === EmployeeRole.ADMIN);
			},
		);
	});

	it.each([
		[EmployeeRole.ADMIN, "admin"],
		[EmployeeRole.REVIEWER, "reviewer"],
		[EmployeeRole.EMPLOYEE, "employee"],
	] as const)("shows the master to %s as %s", (role, mode) => {
		expect(access.resolveEmployeeMasterMode(role)).toBe(mode);
	});

	it("treats a role the app does not know as an Employee", () => {
		const unknown = EmployeeRole.fromStored("Owner");
		expect(access.resolveEmployeeMasterMode(unknown)).toBe("employee");
		expect(Object.values(ADMIN_ONLY).some((allows) => allows(unknown))).toBe(false);
	});
});

// 基本設計 4.1: 社員マスタで、誰の何を見られるか。DB(employees の行ポリシーと employee_details)も同じ判定に従い、
// EmployeeVisibilitySql.test.ts が DB の答えをこの判定と突き合わせる
describe("who sees which employee, and what of them", () => {
	it("lets Admin and Reviewer see every employee, and anyone else only the people they work with", () => {
		expect(EmployeeRole.ALL.filter(access.canViewAllEmployees)).toEqual([
			EmployeeRole.ADMIN,
			EmployeeRole.REVIEWER,
		]);
	});

	it.each([
		// 等級は、評価者を決める Admin と、評価する Reviewer が見る。Employee には同僚の等級を見せない
		["grade", [EmployeeRole.ADMIN, EmployeeRole.REVIEWER]],
		// 誰が Admin か、誰が共有PCを使うか、誰が登録・利用停止されているかは、管理する Admin だけ
		["role", [EmployeeRole.ADMIN]],
		["keepSignedIn", [EmployeeRole.ADMIN]],
		["account", [EmployeeRole.ADMIN]],
	] as const)("shows another employee's %s only to %j", (detail, viewers) => {
		expect(
			EmployeeRole.ALL.filter((role) => access.canViewEmployeeDetail(role, detail, false)),
		).toEqual(viewers);
	});

	it("shows everyone all of their own details", () => {
		for (const role of [...EmployeeRole.ALL, EmployeeRole.fromStored("Owner")]) {
			for (const detail of access.EMPLOYEE_DETAILS) {
				expect(access.canViewEmployeeDetail(role, detail, true)).toBe(true);
			}
		}
	});

	it("hides every other employee's detail from a role the app does not know", () => {
		const unknown = EmployeeRole.fromStored("Owner");
		expect(access.canViewAllEmployees(unknown)).toBe(false);
		for (const detail of access.EMPLOYEE_DETAILS) {
			expect(access.canViewEmployeeDetail(unknown, detail, false)).toBe(false);
		}
	});

	describe("the people an employee works with", () => {
		// 1 → 2(一次)・3(二次)。2 は 4 の一次評価者でもある。5 は無関係。
		// シート 10 は異動前の記録: 本人 1、評価者 6・7
		const employees = [
			{ employeeId: 1, primaryEvaluatorId: 2, secondaryEvaluatorId: 3 },
			{ employeeId: 2, primaryEvaluatorId: null, secondaryEvaluatorId: null },
			{ employeeId: 3, primaryEvaluatorId: null, secondaryEvaluatorId: null },
			{ employeeId: 4, primaryEvaluatorId: 2, secondaryEvaluatorId: null },
			{ employeeId: 5, primaryEvaluatorId: null, secondaryEvaluatorId: null },
			{ employeeId: 6, primaryEvaluatorId: null, secondaryEvaluatorId: null },
			{ employeeId: 7, primaryEvaluatorId: null, secondaryEvaluatorId: null },
		];
		const sheets = [{ employeeId: 1, primaryEvaluatorId: 6, secondaryEvaluatorId: 7 }];
		const colleagues = (viewerId: number) =>
			[...access.evaluationColleagueIds(viewerId, employees, sheets)].sort();

		it("includes themselves, their evaluators, and the people on their sheets", () => {
			expect(colleagues(1)).toEqual([1, 2, 3, 6, 7]);
		});

		it("includes the people they evaluate, but not those people's other evaluators", () => {
			expect(colleagues(2)).toEqual([1, 2, 4]);
			// 二次評価者も、評価する本人だけ。同じ本人の一次評価者は含めない
			expect(colleagues(3)).toEqual([1, 3]);
		});

		it("includes the subject and the other evaluator of a sheet they evaluated before a transfer", () => {
			expect(colleagues(6)).toEqual([1, 6, 7]);
		});

		it("is only themselves when they work with nobody, and nobody when they are not an employee", () => {
			expect(colleagues(5)).toEqual([5]);
			expect(colleagues(99)).toEqual([]);
		});
	});
});
