/** 評価の点数。チャレンジ目標も共通評価の項目も、1〜4 の4段階で評価する。0 は未評価。 */
export class Score {
	static readonly MAX = 4;

	private constructor(public readonly value: number) {}

	/** 0(未評価)〜4 の整数か。画面や API から来た値は、保存の前にこれで確かめる。 */
	static isValid(value: unknown): value is number {
		return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= Score.MAX;
	}

	static from(value: number): Score {
		if (!Score.isValid(value)) {
			throw new Error(`点数は 0〜${Score.MAX} の整数で指定してください。`);
		}
		return new Score(value);
	}

	static fromOptional(value?: number | null): Score {
		return Score.from(value ?? 0);
	}

	toNumber(): number {
		return this.value;
	}
}
