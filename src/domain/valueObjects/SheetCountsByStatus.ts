import { EvaluationStatus, type EvaluationStatusValue } from "./EvaluationStatus";

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
		return EvaluationStatus.ALL.filter((status) => !status.isFinalized() && this.of(status) > 0)
			.map((status) => `${status.label()} ${this.of(status)} 件`)
			.join("・");
	}
}
