import { describeMilestoneError, type MilestoneError } from "../../domain/entities/MilestoneError";
import {
	describeSheetTransitionError,
	type SheetTransitionError,
} from "../../domain/entities/SheetTransitionError";
import {
	describeSheetAccessError,
	type SheetAccessError,
} from "../../domain/services/SheetAccessError";

/** 評価シートを扱うユースケースの、リクエストそのものの誤り。 */
export type SheetRequestError =
	/** シートが無い、または読む権限が無い(DB からは同じく見えない)。 */
	| { kind: "sheetNotFound" }
	/** ほかのシートの目標を指した。 */
	| { kind: "goalNotOnSheet" }
	| { kind: "goalNumberInvalid" }
	| { kind: "tooManyGoals"; max: number }
	| { kind: "lastGoal" }
	| { kind: "nothingToSave" }
	| { kind: "scoreOutOfRange" }
	| { kind: "actionUnknown" }
	| { kind: "previousGoalInvalid" }
	/** このシートの共通評価の項目でない、または同じ項目を2回指した。 */
	| { kind: "commonItemInvalid" };

/** 評価シートを扱うユースケースが返し得る失敗のすべて。各ユースケースは、このうち起こり得るものだけを返す。 */
export type SheetEditError =
	| SheetRequestError
	| SheetAccessError
	| MilestoneError
	| SheetTransitionError;

/** SheetRequestError のうち、kinds の失敗だけ。 */
export type RequestErrorOf<K extends SheetRequestError["kind"]> = Extract<
	SheetRequestError,
	{ kind: K }
>;

function describeSheetRequestError(error: SheetRequestError): string {
	switch (error.kind) {
		case "sheetNotFound":
			return "評価シートが見つかりません。";
		case "goalNotOnSheet":
			return "対象の目標はこの評価シートに属していません。";
		case "goalNumberInvalid":
			return "目標番号が不正です。";
		case "tooManyGoals":
			return `チャレンジ目標は最大${error.max}件です。`;
		case "lastGoal":
			return "チャレンジ目標は最低1件必要です。";
		case "nothingToSave":
			return "保存する内容がありません。";
		case "scoreOutOfRange":
			return "評価点は 0〜4 の整数で指定してください。";
		case "actionUnknown":
			return "目標への操作が不正です。";
		case "previousGoalInvalid":
			return "前期の目標が不正です。";
		case "commonItemInvalid":
			return "共通評価項目が不正または重複しています。";
	}
}

/** 失敗を、操作した人に見せる文にする。 */
export function describeSheetEditError(error: SheetEditError): string {
	switch (error.kind) {
		case "periodGoalsMalformed":
		case "tooManyPeriodGoals":
		case "achievementBesideTasks":
		case "goalsFixed":
			return describeMilestoneError(error);
		case "objectivesIncomplete":
		case "evaluationIncomplete":
			return describeSheetTransitionError(error);
		case "periodClosed":
		case "forbidden":
		case "transitionForbidden":
			return describeSheetAccessError(error);
		default:
			return describeSheetRequestError(error);
	}
}
