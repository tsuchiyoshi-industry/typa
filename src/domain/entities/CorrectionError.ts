import type { MilestoneError } from "./MilestoneError";
import { describeMilestoneError } from "./MilestoneError";

/** 締め後修正(遡及処理)の、失敗の種類。 */
export type CorrectionError =
	/** 実施中・未開始の評価期間のシート。ふだんの記入と評価で直す。 */
	| { kind: "periodNotClosed" }
	| { kind: "reasonInvalid"; max: number }
	| { kind: "noChanges" }
	/** 遡及処理で直せる項目ではない(状態・評価者・ランクなどは直さない)。 */
	| { kind: "fieldNotCorrectable" }
	| { kind: "scoreInvalid" }
	| { kind: "textTooLong"; max: number }
	| { kind: "periodGoalsMalformed" }
	/** 二次評価者を置かないシートの、二次評価点。 */
	| { kind: "noSecondScore" }
	| { kind: "notThisSheetGoal" }
	| { kind: "notThisSheetItem" }
	| { kind: "sameValue"; subject: string }
	| { kind: "duplicate" }
	/** 直した後のチャレンジ目標が、目標のきまりに合わない。 */
	| { kind: "goalInvalid"; goalNumber: number; error: MilestoneError };

export function describeCorrectionError(error: CorrectionError): string {
	switch (error.kind) {
		case "periodNotClosed":
			return "遡及処理で修正できるのは、締め済みの評価期間のシートだけです。";
		case "reasonInvalid":
			return `修正の理由を ${error.max} 文字以内で入力してください。`;
		case "noChanges":
			return "修正する項目がありません。";
		case "fieldNotCorrectable":
			return "遡及処理で直せない項目です。";
		case "scoreInvalid":
			return "点数は 1〜4 で入力してください。";
		case "textTooLong":
			return `文章は ${error.max} 文字以内で入力してください。`;
		case "periodGoalsMalformed":
			return "期中目標の形式が不正です。";
		case "noSecondScore":
			return "二次評価者を置かないシートには、二次評価点はありません。";
		case "notThisSheetGoal":
			return "このシートの目標ではありません。";
		case "notThisSheetItem":
			return "このシートの共通評価の項目ではありません。";
		case "sameValue":
			return `「${error.subject}」は、今と同じ内容には修正できません。`;
		case "duplicate":
			return "同じ項目を一度に2回直すことはできません。";
		case "goalInvalid":
			return `チャレンジ目標 ${error.goalNumber}: ${describeMilestoneError(error.error)}`;
	}
}
