import { err, ok, type Result } from "../Result";
import { PeriodState } from "../valueObjects/PeriodState";
import type { SheetCountsByStatus } from "../valueObjects/SheetCountsByStatus";
import type { EvaluationPeriod } from "./EvaluationPeriod";
import type { PeriodError } from "./PeriodError";

/** 時期の新しい順に並べる。終了日、開始日、id の順に比べる(重なった期間でも順番が1つに決まる)。 */
const latestFirst = (a: EvaluationPeriod, b: EvaluationPeriod) =>
	b.range.end.compare(a.range.end) || b.range.start.compare(a.range.start) || b.id - a.id;

/** 次に開始する順。開始日の早い順、同じなら古い(id の小さい)順。 */
const earliestStartFirst = (a: EvaluationPeriod, b: EvaluationPeriod) =>
	a.range.start.compare(b.range.start) || a.id - b.id;

/**
 * 会社のすべての評価期間。新しい順に並べ、実施中の評価期間と、名前の重なりを引く。
 * 前の評価期間(前期の目標を引き継ぐ元)は DB の previous_evaluation_period が決める。
 *
 * 業務のきまり: 評価期間は「締める」と「開始する」を分けて行う。締めると、次に開始する評価期間
 * (まだ始めていないうち、いちばん早く始まるもの)が準備中になる。準備中の間に、管理者が等級の変更などを
 * 済ませてから開始する。実施中の評価期間がある間は、準備中の評価期間は無い。
 */
export class EvaluationCalendar {
	private readonly periods: readonly EvaluationPeriod[];

	constructor(periods: readonly EvaluationPeriod[]) {
		const waiting = periods.filter(
			(period) => period.state === PeriodState.NOT_STARTED || period.isPreparing,
		);
		const next = periods.some((period) => period.isActive)
			? undefined
			: [...waiting].sort(earliestStartFirst)[0];
		// 準備中は保存しないので、渡された状態によらず、ここで1つに決め直す
		this.periods = periods
			.map((period) =>
				period === next
					? period.inState(PeriodState.PREPARING)
					: period.isPreparing
						? period.inState(PeriodState.NOT_STARTED)
						: period,
			)
			.sort(latestFirst);
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

	/** 準備中(次に開始する)の評価期間。実施中の評価期間がある間と、開始できる評価期間が無いときは null。 */
	preparing(): EvaluationPeriod | null {
		return this.periods.find((period) => period.isPreparing) ?? null;
	}

	/** その名前の評価期間がすでにある(exceptId の評価期間は数えない)。 */
	hasPeriodNamed(name: string, exceptId?: number): boolean {
		return this.periods.some((period) => period.periodName === name && period.id !== exceptId);
	}

	/**
	 * 実施中の評価期間を締めた後の暦。次の評価期間は準備中になり、自動では始まらない。
	 * 評価が確定していないシートが残っていれば締めない(締めてよいとした評価期間を除く)。
	 */
	close(sheets: SheetCountsByStatus): Result<EvaluationCalendar, PeriodError> {
		const active = this.active();
		if (!active) {
			return err({ kind: "noActivePeriod" });
		}
		const closable = active.closable(sheets);
		if (!closable.ok) {
			return closable;
		}
		return ok(this.replace(active.inState(PeriodState.CLOSED)));
	}

	/** 準備中の評価期間を開始した後の暦。実施中の評価期間を締める前と、準備中でない評価期間は開始しない。 */
	start(periodId: number): Result<EvaluationCalendar, PeriodError> {
		const target = this.find(periodId);
		if (!target) {
			return err({ kind: "periodNotFound" });
		}
		const startable = target.startable();
		if (!startable.ok) {
			return startable;
		}
		const active = this.active();
		if (active) {
			return err({ kind: "closeBeforeStart", periodName: active.periodName });
		}
		if (!target.isPreparing) {
			return err({
				kind: "notPreparing",
				periodName: target.periodName,
				preparingName: this.preparing()?.periodName ?? "",
			});
		}
		return ok(this.replace(target.inState(PeriodState.ACTIVE)));
	}

	private replace(changed: EvaluationPeriod): EvaluationCalendar {
		return new EvaluationCalendar(
			this.periods.map((period) => (period.id === changed.id ? changed : period)),
		);
	}
}
