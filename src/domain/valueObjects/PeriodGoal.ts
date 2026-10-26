import { DomainError } from "../DomainError";

/** チャレンジ目標に紐づくタスク。達成状況は自由記入で、完了・次期継続の状態は持たない。 */
export interface PeriodGoal {
	description: string;
	achievement: string;
}

/** 1つのチャレンジ目標に置ける期中目標の数。DB の valid_period_goals と同じ。 */
export const MAX_PERIOD_GOALS = 4;

export const emptyPeriodGoals = (): PeriodGoal[] => [];

export function assertPeriodGoals(goals: unknown): asserts goals is readonly PeriodGoal[] {
	if (
		!Array.isArray(goals) ||
		goals.length > MAX_PERIOD_GOALS ||
		goals.some(
			(goal) =>
				!goal ||
				typeof goal !== "object" ||
				typeof goal.description !== "string" ||
				typeof goal.achievement !== "string" ||
				Object.keys(goal).some((key) => key !== "description" && key !== "achievement"),
		)
	) {
		throw new DomainError(
			`期中目標は0〜${MAX_PERIOD_GOALS}件のタスクと達成状況で指定してください。`,
		);
	}
}

/** 形を確かめてから、入力順とタスクごとの達成状況の対応を保って複製する。 */
export function copyPeriodGoals(goals: readonly PeriodGoal[]): PeriodGoal[] {
	assertPeriodGoals(goals);
	return goals.map((goal) => ({ description: goal.description, achievement: goal.achievement }));
}

/**
 * 期中目標を1件足す。最初の1件には、それまでチャレンジ目標に書いていた達成状況を移す
 * (期中目標があるときは、達成状況はタスクごとに書く。書いた内容は捨てない)。
 */
export function addPeriodGoal(
	goals: readonly PeriodGoal[],
	achievement: string,
): { periodGoals: PeriodGoal[]; achievement: string } {
	if (goals.length >= MAX_PERIOD_GOALS) {
		throw new DomainError(`期中目標は最大${MAX_PERIOD_GOALS}件です。`);
	}
	return {
		periodGoals: [
			...copyPeriodGoals(goals),
			{ description: "", achievement: goals.length === 0 ? achievement : "" },
		],
		achievement: "",
	};
}
