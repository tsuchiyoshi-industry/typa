import { err, expectOk, ok, type Result } from "../Result";
import { DateRange } from "../valueObjects/DateRange";
import type { PeriodDivision } from "../valueObjects/PeriodDivision";
import { PeriodPart } from "../valueObjects/PeriodPart";
import type { TermName } from "../valueObjects/TermName";
import { EvaluationPeriodPlan } from "./EvaluationPeriodPlan";
import { describePeriodError, type PeriodError } from "./PeriodError";

/**
 * 期(年度)。開始日・終了日と区切り方から、独立した評価期間に分ける。
 * 開始日から 6 か月(四半期は 3 か月)ずつ区切り、最後の評価期間は終了日まで。
 * 3/23 始まりの年度なら、上期は 3/23〜9/22、下期は 9/23〜終了日。区切りの日がその月にないとき
 * (8/31 の半年後など)は、その月の末日で区切る。
 */
export class EvaluationTerm {
	private constructor(
		readonly name: TermName,
		readonly range: DateRange,
		readonly division: PeriodDivision,
		private readonly ranges: readonly DateRange[],
	) {}

	/** 区切った評価期間のどれかが空になる(期が短すぎる)ときは失敗。 */
	static of(
		name: TermName,
		range: DateRange,
		division: PeriodDivision,
	): Result<EvaluationTerm, PeriodError> {
		const starts = Array.from({ length: division.parts }, (_, i) =>
			range.start.addMonths(division.monthsPerPart * i),
		);
		const ends = [...starts.slice(1).map((start) => start.previousDay()), range.end];
		if (starts.some((start, i) => ends[i].isBefore(start))) {
			return err({ kind: "termTooShort", division: division.label });
		}
		return ok(
			new EvaluationTerm(
				name,
				range,
				division,
				// どの区切りも開始日 <= 終了日であることは、上で確かめてある
				starts.map((start, i) => expectOk(DateRange.of(start, ends[i]), describePeriodError)),
			),
		);
	}

	/** 区切った評価期間。上期・下期のように、時期の早い順。 */
	divide(allowUnfinalizedClose: boolean): EvaluationPeriodPlan[] {
		return this.ranges.map(
			(range, i) =>
				new EvaluationPeriodPlan(
					this.name,
					PeriodPart.of(this.division, i + 1),
					range,
					allowUnfinalizedClose,
				),
		);
	}
}
