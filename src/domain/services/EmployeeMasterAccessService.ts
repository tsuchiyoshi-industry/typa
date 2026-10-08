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

/** 評価の基準(配点など)を決める「設定」は Admin だけが変更できる。 */
export function canEditSettings(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) === "admin";
}

/**
 * 全社員の評価シートを、一覧も内容(目標・点数・コメント・評価ランク)も見られるのは Admin だけ。
 * できるのは閲覧と確定済みシートの出力まで。記入・評価・提出・確定は、Admin でも
 * そのシートの本人・評価者でなければできない(EvaluationSheetAccessPolicy)。
 */
export function canViewAllSheets(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) === "admin";
}

/** 登録の取り消し(ログイン用アカウントの削除)は Admin だけが行える。 */
export function canResetRegistrations(role: EmployeeRole): boolean {
	return resolveEmployeeMasterMode(role) === "admin";
}
