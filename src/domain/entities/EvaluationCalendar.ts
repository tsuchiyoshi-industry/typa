import type { EvaluationPeriod } from "./EvaluationPeriod";

/** 時期の新しい順に並べる。終了日、開始日、id の順に比べる(重なった期間でも順番が1つに決まる)。 */
const latestFirst = (a: EvaluationPeriod, b: EvaluationPeriod) =>
	b.range.end.compare(a.range.end) || b.range.start.compare(a.range.start) || b.id - a.id;

/**
 * 会社のすべての評価期間。新しい順に並べ、実施中の評価期間と、名前の重なりを引く。
 * 前の評価期間(前期の目標を引き継ぐ元)は DB の previous_evaluation_period が決める。
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

	/** その名前の評価期間がすでにある(exceptId の評価期間は数えない)。 */
	hasPeriodNamed(name: string, exceptId?: number): boolean {
		return this.periods.some((period) => period.periodName === name && period.id !== exceptId);
	}
}
