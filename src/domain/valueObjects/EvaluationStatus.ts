export type EvaluationStatusValue = "draft" | "submitted" | "first_evaluated" | "finalized";

/** 下書き → 提出済み(一次評価待ち) → 一次評価済み(二次評価待ち) → 評価確定。 */
export class EvaluationStatus {
	private constructor(private readonly value: EvaluationStatusValue) {}

	/** 本人が編集中。評価者はまだ内容を見られない。 */
	static readonly DRAFT = new EvaluationStatus("draft");
	/** 本人が提出済みで、一次評価者の評価を待っている。 */
	static readonly SUBMITTED = new EvaluationStatus("submitted");
	/** 一次評価者が確定済み。一次評価は変更できず、二次評価者の評価を待っている。 */
	static readonly FIRST_EVALUATED = new EvaluationStatus("first_evaluated");
	/** 最終評価者による確定ロック。本人による差し戻しも不可になる。 */
	static readonly FINALIZED = new EvaluationStatus("finalized");

	static from(value: string): EvaluationStatus {
		const status = [
			EvaluationStatus.DRAFT,
			EvaluationStatus.SUBMITTED,
			EvaluationStatus.FIRST_EVALUATED,
			EvaluationStatus.FINALIZED,
		].find((candidate) => candidate.value === value);
		if (!status) {
			throw new Error("Invalid evaluation status.");
		}
		return status;
	}

	isDraft(): boolean {
		return this.value === "draft";
	}

	isSubmitted(): boolean {
		return this.value !== "draft";
	}

	isAwaitingFirstEvaluation(): boolean {
		return this.value === "submitted";
	}

	isAwaitingSecondEvaluation(): boolean {
		return this.value === "first_evaluated";
	}

	/** 一次評価が確定している(一次評価済み、または評価確定)。 */
	isFirstEvaluationConfirmed(): boolean {
		return this.value === "first_evaluated" || this.value === "finalized";
	}

	isFinalized(): boolean {
		return this.value === "finalized";
	}

	toString(): EvaluationStatusValue {
		return this.value;
	}

	equals(other: EvaluationStatus): boolean {
		return this.value === other.value;
	}
}
