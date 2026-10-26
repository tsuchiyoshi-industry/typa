import type { EvaluationStatusValue } from "../valueObjects/EvaluationStatus";

/** 評価シートに対する操作。権限が無いときに、何をしようとしたかを示す。 */
export type SheetAction =
	| "view"
	| "deleteGoal"
	| "editGoalText"
	| "editFirstScore"
	| "editSecondScore"
	| "editCommonEvaluation"
	| "editFirstOverallComment"
	| "editSecondOverallComment"
	| "carryOverGoal"
	| "resendNotification";

/** 評価シートへの操作が、役割・状態・評価期間の上で許されない(EvaluationSheetAccessPolicy の判断)。 */
export type SheetAccessError =
	/** 締めた評価期間のシートは、役割によらず変更できない。 */
	| { kind: "periodClosed" }
	| { kind: "forbidden"; action: SheetAction }
	| { kind: "transitionForbidden"; to: EvaluationStatusValue };

const FORBIDDEN: Record<SheetAction, string> = {
	view: "評価シートを閲覧する権限がありません。",
	deleteGoal: "自分の評価シートの目標のみ削除できます。",
	editGoalText: "この状態では目標・達成状況を編集できません。",
	editFirstScore: "一次評価者のみ一次評価を編集できます。",
	editSecondScore: "二次評価者のみ二次評価を編集できます。",
	editCommonEvaluation: "共通評価を更新する権限がありません。",
	editFirstOverallComment: "一次評価者の総評を更新する権限がありません。",
	editSecondOverallComment: "二次評価者の総評を更新する権限がありません。",
	carryOverGoal: "前期の目標を引き継げるのは、本人の下書きの評価シートだけです。",
	resendNotification: "この評価シートの通知を送る権限がありません。",
};

const TRANSITION_FORBIDDEN: Record<EvaluationStatusValue, string> = {
	draft: "一次評価者のみ、送信済みの目標を要修正として下書きに戻せます。",
	goals_submitted: "自分の下書きの目標のみ送信できます。",
	goals_confirmed: "一次評価者のみ、送信済みの目標を確定できます。",
	submitted: "一次評価を依頼できるのは、目標確定後の本人だけです。",
	first_evaluated: "一次評価者のみ、一次評価待ちのシートの一次評価を確定できます。",
	finalized:
		"最終評価者(二次評価者。「なし」の場合は一次評価者)のみ、一次評価が確定したシートを確定できます。二次評価者が未設定の場合は、先に社員マスタで設定してください。",
};

export function describeSheetAccessError(error: SheetAccessError): string {
	switch (error.kind) {
		case "periodClosed":
			return "この評価期間は締められているため、評価シートを変更できません。変更が必要な場合は、TYPA の管理担当者に連絡してください。";
		case "forbidden":
			return FORBIDDEN[error.action];
		case "transitionForbidden":
			return TRANSITION_FORBIDDEN[error.to];
	}
}
