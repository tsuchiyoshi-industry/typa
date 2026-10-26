import type { PreviousGoals } from "../repositories/MilestoneRepository";

/**
 * 前期のチャレンジ目標とのつながり。チャレンジ目標は期をまたいで続くことがあり、
 * 本人は前期の目標を据え置く(kept)か、見直して更新する(revised)かを選ぶ。
 * 期中目標はその期の計画なので、つながりは持たない。
 */
export interface GoalContinuity {
	kind: "kept" | "revised";
	periodName: string;
	previous: { goalNumber: number; challengeGoal: string };
}

/** 今期の目標番号 goalNumber の目標が、前期のどの目標から来たか。前期から来ていなければ null。 */
export function continuityOf(
	goalNumber: number,
	challengeGoal: string,
	previous: PreviousGoals | null | undefined,
): GoalContinuity | null {
	const source = previous?.goals.find((goal) => goal.carriedInto === goalNumber);
	if (!previous || !source) {
		return null;
	}
	return {
		kind: source.challengeGoal.trim() === challengeGoal.trim() ? "kept" : "revised",
		periodName: previous.periodName,
		previous: { goalNumber: source.goalNumber, challengeGoal: source.challengeGoal },
	};
}
