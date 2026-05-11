export class Score {
	private constructor(public readonly value: number) {}

	static from(value: number): Score {
		if (!Number.isFinite(value) || value < 0) {
			throw new Error("Score must be a non-negative number.");
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
