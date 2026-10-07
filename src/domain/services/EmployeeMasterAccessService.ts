import type { EmployeeRole, EmployeeRoleName } from "../valueObjects/EmployeeRole";

export type EmployeeMasterMode = "admin" | "reviewer" | "employee";

const MODES: Record<EmployeeRoleName, EmployeeMasterMode> = {
	Admin: "admin",
	Reviewer: "reviewer",
	Employee: "employee",
};

export function resolveEmployeeMasterMode(role: EmployeeRole): EmployeeMasterMode {
	return MODES[role.toString()];
}

export function canEditEvaluators(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) !== "employee";
}

export function canEditGrades(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) === "admin";
}

/** 権限(誰が Admin / Reviewer / Employee か)の閲覧と変更は Admin だけが行える。 */
export function canEditRoles(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) === "admin";
}

/** 登録の取り消し(ログイン用アカウントの削除)は Admin だけが行える。 */
export function canResetRegistrations(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) === "admin";
}
