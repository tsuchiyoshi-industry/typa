export const FINAL_EVALUATION_RANK_LETTERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
export const FINAL_EVALUATION_RANK_LEVELS = ["plus", "none", "minus"] as const;

export type FinalEvaluationRankLetter = (typeof FINAL_EVALUATION_RANK_LETTERS)[number];
export type FinalEvaluationRankLevel = (typeof FINAL_EVALUATION_RANK_LEVELS)[number];

export const FINAL_EVALUATION_RANK_LEVEL_SYMBOLS: Record<FinalEvaluationRankLevel, string> = {
	plus: "＋",
	none: "",
	minus: "－",
};

export class FinalEvaluationRank {
	private constructor(
		public readonly letter: FinalEvaluationRankLetter,
		public readonly level: FinalEvaluationRankLevel,
	) {}

	static from(
		letter: FinalEvaluationRankLetter,
		level: FinalEvaluationRankLevel,
	): FinalEvaluationRank {
		return new FinalEvaluationRank(letter, level);
	}

	static fromOptional(
		letter?: string | null,
		level?: string | null,
	): FinalEvaluationRank | undefined {
		if (!letter || !level) {
			return undefined;
		}
		if (!FinalEvaluationRank.isLetter(letter) || !FinalEvaluationRank.isLevel(level)) {
			throw new Error("Invalid final evaluation rank.");
		}
		return new FinalEvaluationRank(letter, level);
	}

	static options(): FinalEvaluationRank[] {
		return FINAL_EVALUATION_RANK_LETTERS.flatMap((letter) =>
			FINAL_EVALUATION_RANK_LEVELS.map((level) => FinalEvaluationRank.from(letter, level)),
		);
	}

	toDisplayText(): string {
		return `${this.letter}${FINAL_EVALUATION_RANK_LEVEL_SYMBOLS[this.level]}`;
	}

	private static isLetter(value: string): value is FinalEvaluationRankLetter {
		return FINAL_EVALUATION_RANK_LETTERS.includes(value as FinalEvaluationRankLetter);
	}

	private static isLevel(value: string): value is FinalEvaluationRankLevel {
		return FINAL_EVALUATION_RANK_LEVELS.includes(value as FinalEvaluationRankLevel);
	}
}
