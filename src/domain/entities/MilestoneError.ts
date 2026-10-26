import { MAX_PERIOD_GOALS } from "../valueObjects/PeriodGoal";

/** チャレンジ目標(期中目標と達成状況を含む)を書き換えるときの、失敗の種類。 */
export type MilestoneError =
	/** 期中目標の一覧の形が違う(配列でない、欄が足りない・多い、文字列でない)。 */
	| { kind: "periodGoalsMalformed" }
	| { kind: "tooManyPeriodGoals"; max: number }
	/** 期中目標があるのに、チャレンジ目標にも達成状況を書いた。 */
	| { kind: "achievementBesideTasks" }
	/** 目標の送信後に、達成状況以外(チャレンジ目標・期中目標の本文・件数・順序)を変えようとした。 */
	| { kind: "goalsFixed" };

export function describeMilestoneError(error: MilestoneError): string {
	switch (error.kind) {
		case "periodGoalsMalformed":
			return `期中目標は0〜${MAX_PERIOD_GOALS}件のタスクと達成状況で指定してください。`;
		case "tooManyPeriodGoals":
			return `期中目標は0〜${error.max}件です。`;
		case "achievementBesideTasks":
			return "期中目標があるときは、達成状況を期中目標ごとに記入してください。";
		case "goalsFixed":
			return "目標確定後は達成状況だけを編集できます。";
	}
}
