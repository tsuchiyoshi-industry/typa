export class EvaluationStatus {
	private constructor(private readonly value: "draft" | "submitted") {}

	static readonly DRAFT = new EvaluationStatus("draft");
	static readonly SUBMITTED = new EvaluationStatus("submitted");

	static from(value: string): EvaluationStatus {
		if (value === "submitted") {
			return EvaluationStatus.SUBMITTED;
		}
		return EvaluationStatus.DRAFT;
	}

	isDraft(): boolean {
		return this.value === "draft";
	}

	isSubmitted(): boolean {
		return this.value === "submitted";
	}

	toString(): string {
		return this.value;
	}

	equals(other: EvaluationStatus): boolean {
		return this.value === other.value;
	}
}
