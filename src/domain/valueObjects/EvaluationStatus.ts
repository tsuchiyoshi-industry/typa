/** 進行順。DB にはこの文字列で保存する。 */
export const EVALUATION_STATUS_VALUES = [
	"draft",
	"submitted",
	"first_evaluated",
	"finalized",
] as const;
export type EvaluationStatusValue = (typeof EVALUATION_STATUS_VALUES)[number];

/**
 * 評価シートの状態。下書き → 提出済み(一次評価待ち) → 一次評価済み(二次評価待ち) → 評価確定。
 * アプリの中では文字列ではなくこの4つを持ち回り、状態による判断はここのメソッドで行う。
 * 状態を増やすときはここに足す。状態ごとの分岐は Record<EvaluationStatusValue, …> で書いてあり、
 * 足した状態の扱いを決めていない箇所はコンパイルエラーになる。
 */
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
	/** 進行順。 */
	static readonly ALL: readonly EvaluationStatus[] = [
		EvaluationStatus.DRAFT,
		EvaluationStatus.SUBMITTED,
		EvaluationStatus.FIRST_EVALUATED,
		EvaluationStatus.FINALIZED,
	];

	/** 知らない値は undefined。 */
	static find(value?: string | null): EvaluationStatus | undefined {
		return EvaluationStatus.ALL.find((status) => status.value === value);
	}

	/** DB や画面から来た値を状態にする。知らない値は例外(勝手に下書きとして開かない)。 */
	static from(value: string): EvaluationStatus {
		const status = EvaluationStatus.find(value);
		if (!status) {
			throw new Error("Invalid evaluation status.");
		}
		return status;
	}

	isDraft(): boolean {
		return this === EvaluationStatus.DRAFT;
	}

	isSubmitted(): boolean {
		return this !== EvaluationStatus.DRAFT;
	}

	isAwaitingFirstEvaluation(): boolean {
		return this === EvaluationStatus.SUBMITTED;
	}

	isAwaitingSecondEvaluation(): boolean {
		return this === EvaluationStatus.FIRST_EVALUATED;
	}

	/** 一次評価が確定している(一次評価済み、または評価確定)。 */
	isFirstEvaluationConfirmed(): boolean {
		return this === EvaluationStatus.FIRST_EVALUATED || this === EvaluationStatus.FINALIZED;
	}

	isFinalized(): boolean {
		return this === EvaluationStatus.FINALIZED;
	}

	/** 進行順での位置(0 が下書き)。 */
	order(): number {
		return EvaluationStatus.ALL.indexOf(this);
	}

	toString(): EvaluationStatusValue {
		return this.value;
	}

	equals(other: EvaluationStatus): boolean {
		return this.value === other.value;
	}
}
