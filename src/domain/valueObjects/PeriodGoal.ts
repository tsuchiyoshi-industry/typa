import type { MilestoneError } from "../entities/MilestoneError";
import { err, ok, type Result } from "../Result";

/** チャレンジ目標に紐づくタスク。達成状況は自由記入で、完了・次期継続の状態は持たない。 */
export interface PeriodGoal {
	description: string;
	achievement: string;
}

/** 1つのチャレンジ目標に置ける期中目標の数。DB の valid_period_goals と同じ。 */
export const MAX_PERIOD_GOALS = 4;

export const emptyPeriodGoals = (): PeriodGoal[] => [];

const isPeriodGoal = (goal: unknown): goal is PeriodGoal =>
	!!goal &&
	typeof goal === "object" &&
	typeof (goal as PeriodGoal).description === "string" &&
	typeof (goal as PeriodGoal).achievement === "string" &&
	Object.keys(goal).every((key) => key === "description" || key === "achievement");

/**
 * 画面や保存値から来た期中目標の一覧を確かめ、入力順とタスクごとの達成状況の対応を保って複製する
 * (呼んだ側が元の配列を書き換えても、結果は変わらない)。
 */
export function toPeriodGoals(value: unknown): Result<readonly PeriodGoal[], MilestoneError> {
	if (!Array.isArray(value) || !value.every(isPeriodGoal)) {
		return err({ kind: "periodGoalsMalformed" });
	}
	if (value.length > MAX_PERIOD_GOALS) {
		return err({ kind: "tooManyPeriodGoals", max: MAX_PERIOD_GOALS });
	}
	return ok(
		value.map((goal) => ({ description: goal.description, achievement: goal.achievement })),
	);
}

/**
 * 期中目標を1件足す。最初の1件には、それまでチャレンジ目標に書いていた達成状況を移す
 * (期中目標があるときは、達成状況はタスクごとに書く。書いた内容は捨てない)。
 */
export function addPeriodGoal(
	goals: readonly PeriodGoal[],
	achievement: string,
): Result<{ periodGoals: PeriodGoal[]; achievement: string }, MilestoneError> {
	if (goals.length >= MAX_PERIOD_GOALS) {
		return err({ kind: "tooManyPeriodGoals", max: MAX_PERIOD_GOALS });
	}
	return ok({
		periodGoals: [
			...goals.map((goal) => ({ ...goal })),
			{ description: "", achievement: goals.length === 0 ? achievement : "" },
		],
		achievement: "",
	});
}
