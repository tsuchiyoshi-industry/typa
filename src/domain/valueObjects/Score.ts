/** 評価の点数。チャレンジ目標も共通評価の項目も、1〜4 の4段階で評価する。0 は未評価。 */
export class Score {
	static readonly MAX = 4;

	private constructor(public readonly value: number) {}

	static from(value: number): Score {
		if (!Number.isFinite(value) || value < 0 || value > Score.MAX) {
			throw new Error(`Score must be between 0 and ${Score.MAX}.`);
		}
		return new Score(Math.floor(value));
	}

	static fromOptional(value?: number | null): Score {
		return Score.from(value ?? 0);
	}

	equals(other: Score): boolean {
		return this.value === other.value;
	}

	toNumber(): number {
		return this.value;
	}
}
