export class EvaluationStatus {
	private constructor(private readonly value: "draft" | "submitted" | "finalized") {}

	static readonly DRAFT = new EvaluationStatus("draft");
	static readonly SUBMITTED = new EvaluationStatus("submitted");
	/** 二次評価者による確定ロック。本人による差し戻しも不可になる。 */
	static readonly FINALIZED = new EvaluationStatus("finalized");

	static from(value: string): EvaluationStatus {
		if (value === "finalized") {
			return EvaluationStatus.FINALIZED;
		}
		if (value === "submitted") {
			return EvaluationStatus.SUBMITTED;
		}
		return EvaluationStatus.DRAFT;
	}

	isDraft(): boolean {
		return this.value === "draft";
	}

	isSubmitted(): boolean {
		return this.value === "submitted" || this.value === "finalized";
	}

	/** 本人が提出済みで、まだ二次評価者が確定していない、評価者による評価入力が可能な段階。 */
	isUnderEvaluation(): boolean {
		return this.value === "submitted";
	}

	isFinalizedBySecondEvaluator(): boolean {
		return this.value === "finalized";
	}

	toString(): string {
		return this.value;
	}

	equals(other: EvaluationStatus): boolean {
		return this.value === other.value;
	}
}
