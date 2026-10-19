/** 1枚のシートに置けるチャレンジ目標の数の上限として、設定できる範囲(DB の制約と同じ)。 */
export const MAX_CHALLENGE_GOALS_RANGE = { min: 1, max: 10 } as const;

export const isValidMaxChallengeGoals = (max: number): boolean =>
	Number.isInteger(max) &&
	max >= MAX_CHALLENGE_GOALS_RANGE.min &&
	max <= MAX_CHALLENGE_GOALS_RANGE.max;
