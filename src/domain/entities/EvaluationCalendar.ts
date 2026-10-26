import type { EvaluationPeriod } from "./EvaluationPeriod";

/** 時期の新しい順に並べる。終了日、開始日、id の順に比べる(重なった期間でも順番が1つに決まる)。 */
const latestFirst = (a: EvaluationPeriod, b: EvaluationPeriod) =>
	b.range.end.compare(a.range.end) || b.range.start.compare(a.range.start) || b.id - a.id;

/**
 * 会社のすべての評価期間。期(年度)と評価期間の関係をここで決める。
 *   - 当期: 実施中の評価期間が属する期の、すべての評価期間(半期制なら上期も下期も)。
 *     分けた評価期間はそれぞれ独立していて、期としてまとめて評価したり平均したりはしない。
 *   - 前の評価期間: その評価期間が始まる前に終わった評価期間のうち、いちばん新しいもの。
 *     下期なら当期の上期、上期なら前期の下期(前期が通年なら前期、四半期なら第4四半期)。
 *     あいだの評価期間が無ければさらに前、1つも無ければ無し。
 */
export class EvaluationCalendar {
	private readonly periods: readonly EvaluationPeriod[];

	constructor(periods: readonly EvaluationPeriod[]) {
		this.periods = [...periods].sort(latestFirst);
	}

	/** 新しい順。 */
	all(): readonly EvaluationPeriod[] {
		return this.periods;
	}

	find(periodId: number): EvaluationPeriod | null {
		return this.periods.find((period) => period.id === periodId) ?? null;
	}

	active(): EvaluationPeriod | null {
		return this.periods.find((period) => period.isActive) ?? null;
	}

	/** period と同じ期の評価期間。時期の早い順(上期、下期)。 */
	termOf(period: EvaluationPeriod): EvaluationPeriod[] {
		return this.periods.filter((other) => other.isInSameTermAs(period)).reverse();
	}

	/** 前の評価期間。無ければ null。 */
	previousOf(period: EvaluationPeriod): EvaluationPeriod | null {
		return this.periods.find((other) => other.range.endsBefore(period.range)) ?? null;
	}

	/** その名前の評価期間がすでにある(exceptId の評価期間は数えない)。 */
	hasPeriodNamed(name: string, exceptId?: number): boolean {
		return this.periods.some((period) => period.periodName === name && period.id !== exceptId);
	}
}
