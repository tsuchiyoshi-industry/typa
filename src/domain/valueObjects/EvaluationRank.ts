// E・F は過去に手入力されたランクを読むために残している。得点率から決まるのは S〜D。
export const EVALUATION_RANK_LETTERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
export const EVALUATION_RANK_LEVELS = ["plus", "none", "minus"] as const;

export type EvaluationRankLetter = (typeof EVALUATION_RANK_LETTERS)[number];
export type EvaluationRankLevel = (typeof EVALUATION_RANK_LEVELS)[number];

const LEVEL_SYMBOLS: Record<EvaluationRankLevel, string> = { plus: "+", none: "", minus: "-" };

/** 得点率(満点に対する%)の下限とランク。上から判定し、どれにも届かなければ D。 */
const SCORE_RATE_THRESHOLDS: readonly [number, EvaluationRankLetter, EvaluationRankLevel][] = [
	[95, "S", "none"],
	[90, "A", "none"],
	[80, "B", "plus"],
	[60, "B", "none"],
	[50, "B", "minus"],
	[40, "C", "none"],
];

/** 評価ランク。評価者が選ぶものではなく、得点率から機械的に決まる。 */
export class EvaluationRank {
	private constructor(
		public readonly letter: EvaluationRankLetter,
		public readonly level: EvaluationRankLevel,
	) {}

	static fromScoreRate(rate: number): EvaluationRank {
		const [, letter, level] = SCORE_RATE_THRESHOLDS.find(([minimum]) => rate >= minimum) ?? [
			0,
			"D",
			"none",
		];
		return new EvaluationRank(letter, level);
	}

	static fromScore(score: number, fullScore: number): EvaluationRank {
		return EvaluationRank.fromScoreRate(fullScore > 0 ? (score / fullScore) * 100 : 0);
	}

	static from(letter: string, level: string): EvaluationRank {
		if (!EvaluationRank.isLetter(letter) || !EvaluationRank.isLevel(level)) {
			throw new Error("Invalid evaluation rank.");
		}
		return new EvaluationRank(letter, level);
	}

	static fromOptional(letter?: string | null, level?: string | null): EvaluationRank | undefined {
		return letter && level ? EvaluationRank.from(letter, level) : undefined;
	}

	/** "B+" のような表示用の文字列から復元する。空なら undefined。 */
	static fromText(text?: string | null): EvaluationRank | undefined {
		if (!text) {
			return undefined;
		}
		const level = EVALUATION_RANK_LEVELS.find(
			(candidate) => candidate !== "none" && text.endsWith(LEVEL_SYMBOLS[candidate]),
		);
		return EvaluationRank.from(level ? text.slice(0, -1) : text, level ?? "none");
	}

	toDisplayText(): string {
		return `${this.letter}${LEVEL_SYMBOLS[this.level]}`;
	}

	private static isLetter(value: string): value is EvaluationRankLetter {
		return EVALUATION_RANK_LETTERS.includes(value as EvaluationRankLetter);
	}

	private static isLevel(value: string): value is EvaluationRankLevel {
		return EVALUATION_RANK_LEVELS.includes(value as EvaluationRankLevel);
	}
}
