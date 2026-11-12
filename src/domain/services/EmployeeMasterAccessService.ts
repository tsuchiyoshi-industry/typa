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

/**
 * 全社員の行(氏名・社員番号・キャリアコース・評価者)を見られるのは、評価者を決める Admin と、評価する Reviewer。
 * ほかの人が見られるのは、評価で関わる人(evaluationColleagueIds)だけ。
 * DB の employees の行ポリシーも、この判定に従う(EmployeeVisibilitySql.test.ts が突き合わせる)。
 */
export const canViewAllEmployees = (role: EmployeeRole): boolean =>
	resolveEmployeeMasterMode(role) !== "employee";

/** 評価で誰と誰が関わるか。社員の評価者の割り当てと、評価シートの本人・評価者の組み合わせ。 */
export interface EvaluationLink {
	employeeId: number;
	primaryEvaluatorId: number | null;
	secondaryEvaluatorId: number | null;
}

/**
 * 全社員を見られない人が見られる社員: 自分、自分の評価者、自分を評価者とする社員、
 * 自分が本人か評価者として関わる評価シート(異動前のものも)の本人と評価者。
 * 評価する社員のほかの評価者は含めない(同じシートに関わっていなければ)。
 */
export function evaluationColleagueIds(
	viewerId: number,
	employees: readonly EvaluationLink[],
	sheets: readonly EvaluationLink[],
): Set<number> {
	const people = (link: EvaluationLink) => [
		link.employeeId,
		link.primaryEvaluatorId,
		link.secondaryEvaluatorId,
	];
	const evaluates = (link: EvaluationLink) =>
		link.primaryEvaluatorId === viewerId || link.secondaryEvaluatorId === viewerId;
	const me = employees.find((employee) => employee.employeeId === viewerId);
	if (!me) {
		return new Set();
	}
	const ids = [
		...people(me),
		...employees.filter(evaluates).map((employee) => employee.employeeId),
		...sheets.filter((sheet) => people(sheet).includes(viewerId)).flatMap(people),
	];
	return new Set(ids.filter((id): id is number => id !== null));
}

/**
 * 見る人を限る社員の項目。氏名・社員番号・キャリアコース・評価者は、その行を見られる人なら誰でも見られる。
 * account は登録の有無と利用状態(ログイン用アカウント)。
 */
export type EmployeeDetail = "grade" | "role" | "keepSignedIn" | "account";

const OTHERS_DETAIL_VIEWERS: Record<EmployeeDetail, Record<EmployeeMasterMode, boolean>> = {
	// 等級は、評価者を決める Admin と、評価する Reviewer が見る。Employee には同僚の等級を見せない
	grade: { admin: true, reviewer: true, employee: false },
	// 誰が Admin か、誰が共有PCを使うか、誰が登録・利用停止されているかは、管理する Admin だけ
	role: { admin: true, reviewer: false, employee: false },
	keepSignedIn: { admin: true, reviewer: false, employee: false },
	account: { admin: true, reviewer: false, employee: false },
};

export const EMPLOYEE_DETAILS = Object.keys(OTHERS_DETAIL_VIEWERS) as readonly EmployeeDetail[];

/**
 * 社員の項目を見られるか。本人の項目は、本人がすべて見られる。
 * DB の employee_details() も、この判定に従う(EmployeeVisibilitySql.test.ts が突き合わせる)。
 */
export function canViewEmployeeDetail(
	viewer: EmployeeRole,
	detail: EmployeeDetail,
	ownRow: boolean,
): boolean {
	return ownRow || OTHERS_DETAIL_VIEWERS[detail][resolveEmployeeMasterMode(viewer)];
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

/** 監査ログ(誰がいつ何を変えたか)を読めるのは Admin だけ。DB の行ポリシーも、利用中の Admin にしか返さない。 */
export const canViewAuditLog = adminOnly;

/**
 * セキュリティの担保(CI の検査で何を確かめているか、何を確かめていないか)を読めるのは Admin だけ。
 * 中身は秘密ではないが、確かめていない範囲まで載せるので、運用を決める人に限る。
 */
export const canViewSecurityAssurance = adminOnly;

/**
 * 等級と共通目標のマスタの閲覧と変更は Admin だけ。直しても既存の評価シートには及ばない
 * (シートは作成時の等級の共通目標を持ち続ける)。DB 関数も、利用中の Admin 以外を断る。
 */
export const canManageGradeMaster = adminOnly;
