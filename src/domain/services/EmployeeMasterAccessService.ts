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

/** 社員マスタの管理操作は、どれも Admin だけが行える。下の名前は「何を」許すかを読み手に示すためのもの。 */
const adminOnly = (role: EmployeeRole): boolean => resolveEmployeeMasterMode(role) === "admin";

export const canEditEvaluators = adminOnly;

export const canEditGrades = adminOnly;

/** 権限(誰が Admin / Reviewer / Employee か)の閲覧と変更は Admin だけが行える。 */
export const canEditRoles = adminOnly;

/**
 * アプリを閉じた後もログインを残すかどうかは、Admin だけが社員ごとに決める。
 * 共有PCを使う社員のログインを残さないための設定で、誰が共有PCを使うかを知っているのは Admin。
 */
export const canEditKeepSignedIn = adminOnly;

/** 評価の基準(配点など)を決める「設定」は Admin だけが変更できる。 */
export const canEditSettings = adminOnly;

/** システム導入時の処理(社員データの取込など)は Admin だけが行える。 */
export const canRunSetup = adminOnly;

/** 遡及処理(締めた評価期間のシートを、開き直さずに直す)は Admin だけが行える。 */
export const canCorrectClosedSheets = adminOnly;

/** 通常の承認・期間の制約を越えたシートの操作。必ず DB が監査記録を残す。 */
export const canRunPrivilegedOperations = adminOnly;

/**
 * 全社員の評価シートを一覧で見て、PDF に出せるのは Admin だけ。一覧には進み具合と評価者、
 * 確定した結果が、PDF にはさらに段ごとのランクと総評が載る。
 * 一覧の行から、関わらないシートを読み取り専用で開ける(EvaluationSheetAccessPolicy の viewsAsAdmin)。
 */
export const canViewAllSheets = adminOnly;

/** 登録の取り消し(ログイン用アカウントの削除)は Admin だけが行える。 */
export const canResetRegistrations = adminOnly;

/** 招待コードの発行と、利用の停止・再開(誰がアプリを使えるか)は Admin だけが行える。 */
export const canManageEmployeeAccess = adminOnly;
