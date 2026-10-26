import { EvaluationStatus, type EvaluationStatusValue } from "./EvaluationStatus";

/** 確定していない状態の呼び方(締められない理由に使う)。 */
const UNFINISHED_LABELS: readonly [EvaluationStatus, string][] = [
	[EvaluationStatus.DRAFT, "下書き"],
	[EvaluationStatus.GOALS_SUBMITTED, "送信済み"],
	[EvaluationStatus.GOALS_CONFIRMED, "目標確定"],
	[EvaluationStatus.SUBMITTED, "一次評価待ち"],
	[EvaluationStatus.FIRST_EVALUATED, "二次評価待ち"],
];

/** 1つの評価期間の評価シートを、状態ごとに数えたもの。 */
export class SheetCountsByStatus {
	private constructor(private readonly counts: ReadonlyMap<EvaluationStatus, number>) {}

	/** 数えていない状態は 0 枚。負の数や小数は来ない前提で、来たら例外。 */
	static from(counts: Partial<Record<EvaluationStatusValue, number>>): SheetCountsByStatus {
		return new SheetCountsByStatus(
			new Map(
				EvaluationStatus.ALL.map((status) => {
					const count = counts[status.toString()] ?? 0;
					if (!Number.isInteger(count) || count < 0) {
						throw new Error("Sheet counts must be non-negative integers.");
					}
					return [status, count] as const;
				}),
			),
		);
	}

	static readonly NONE = SheetCountsByStatus.from({});

	of(status: EvaluationStatus): number {
		return this.counts.get(status) ?? 0;
	}

	total(): number {
		return EvaluationStatus.ALL.reduce((sum, status) => sum + this.of(status), 0);
	}

	/** 評価が確定していないシート(下書き・一次評価待ち・二次評価待ち)の枚数。 */
	unfinished(): number {
		return this.total() - this.of(EvaluationStatus.FINALIZED);
	}

	/** 「下書き 2 件・二次評価待ち 1 件」。確定していないシートが無ければ空文字。 */
	describeUnfinished(): string {
		return UNFINISHED_LABELS.filter(([status]) => this.of(status) > 0)
			.map(([status, label]) => `${label} ${this.of(status)} 件`)
			.join("・");
	}
}
