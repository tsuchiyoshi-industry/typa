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
};

describe("employee master access", () => {
	it("checks every permission the service offers", () => {
		const offered = Object.keys(access).filter((name) => name.startsWith("can"));
		expect(offered.sort()).toEqual(Object.keys(ADMIN_ONLY).sort());
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
