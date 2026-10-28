/** 進行順。DB にはこの文字列で保存する。 */
export const EVALUATION_STATUS_VALUES = [
	"draft",
	"goals_submitted",
	"goals_confirmed",
	"submitted",
	"first_evaluated",
	"finalized",
] as const;
export type EvaluationStatusValue = (typeof EVALUATION_STATUS_VALUES)[number];

/** シートを受け渡す人。本人・一次評価者・二次評価者。 */
export type SheetActor = "subject" | "primary" | "secondary";

/**
 * 業務のきまり: その状態のとき、ボールを持っている(次に動く)のは誰か。最終評価済みは誰も持たない。
 * DB の next_evaluator_of も同じきまりで、アプリ内通知の宛先を決める。
 */
const HOLDERS: Record<EvaluationStatusValue, SheetActor | null> = {
	draft: "subject",
	goals_submitted: "primary",
	goals_confirmed: "subject",
	submitted: "primary",
	first_evaluated: "secondary",
	finalized: null,
};

/**
 * その状態へ進めるのは誰か。下書きへは一次評価者が要修正として戻す(作ったばかりの下書きは渡していない)。
 */
const MOVED_BY: Record<EvaluationStatusValue, SheetActor> = {
	draft: "primary",
	goals_submitted: "subject",
	goals_confirmed: "primary",
	submitted: "subject",
	first_evaluated: "primary",
	finalized: "secondary",
};

/**
 * 状態の呼び名。「いま何を待っているか」でそろえ、済・中は使わない(誰の番かは「いまの担当」で示す)。
 * 始まりの下書きと終わりの評価確定だけは、自然な言葉にする。
 */
const LABELS: Record<EvaluationStatusValue, string> = {
	draft: "下書き",
	goals_submitted: "目標確認待ち",
	goals_confirmed: "振り返り待ち",
	submitted: "一次評価待ち",
	first_evaluated: "二次評価待ち",
	finalized: "評価確定",
};

/**
 * 評価シートの状態。下書き → 目標確認待ち → 振り返り待ち(目標確定後、本人が達成状況を書く) → 一次評価待ち →
 * 二次評価待ち → 評価確定。
 * アプリの中では文字列ではなくこの6つを持ち回り、状態による判断はここのメソッドで行う。
 * 状態を増やすときはここに足す。状態ごとの分岐は Record<EvaluationStatusValue, …> で書いてあり、
 * 足した状態の扱いを決めていない箇所はコンパイルエラーになる。
 */
export class EvaluationStatus {
	private constructor(private readonly value: EvaluationStatusValue) {}

	/** 本人が目標を編集中(要修正で戻されたときも)。評価者はまだ内容を見られない。 */
	static readonly DRAFT = new EvaluationStatus("draft");
	/** 本人が目標を送信済みで、一次評価者の確認(確定か要修正)を待っている。 */
	static readonly GOALS_SUBMITTED = new EvaluationStatus("goals_submitted");
	/** 一次評価者が目標を確定済み。目標は固定で、本人が達成状況だけを記入する。 */
	static readonly GOALS_CONFIRMED = new EvaluationStatus("goals_confirmed");
	/** 本人が一次評価を依頼済み。本人は変更できず、一次評価を待っている。 */
	static readonly SUBMITTED = new EvaluationStatus("submitted");
	/** 一次評価者が確定済み。一次評価は変更できず、二次評価者の評価を待っている。 */
	static readonly FIRST_EVALUATED = new EvaluationStatus("first_evaluated");
	/** 最終評価者が確定済み。誰も変更できない。 */
	static readonly FINALIZED = new EvaluationStatus("finalized");
	/** 進行順。 */
	static readonly ALL: readonly EvaluationStatus[] = [
		EvaluationStatus.DRAFT,
		EvaluationStatus.GOALS_SUBMITTED,
		EvaluationStatus.GOALS_CONFIRMED,
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

	/** 本人が目標を送信した後(評価者が内容を見られる)。 */
	isSentToEvaluators(): boolean {
		return this !== EvaluationStatus.DRAFT;
	}

	/** 一次評価が依頼され、採点が始まった後。目標の確認中は点数もランクもまだ無い。 */
	isEvaluationStarted(): boolean {
		return this.order() >= EvaluationStatus.SUBMITTED.order();
	}

	/** この状態のとき、ボールを持っている人。最終評価済みは null。 */
	holder(): SheetActor | null {
		return HOLDERS[this.value];
	}

	/**
	 * この状態になったとき、誰から誰へ渡ったか(to はボールの持ち主)。通知は to へ送り、再送できるのは from の人。
	 * 評価の確定は次に動く人がいないので null。
	 */
	handoff(): { from: SheetActor; to: SheetActor } | null {
		const to = this.holder();
		return to && { from: MOVED_BY[this.value], to };
	}

	label(): string {
		return LABELS[this.value];
	}

	isGoalsSubmitted(): boolean {
		return this === EvaluationStatus.GOALS_SUBMITTED;
	}

	isGoalsConfirmed(): boolean {
		return this === EvaluationStatus.GOALS_CONFIRMED;
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
