import type { PeriodDivision } from "./PeriodDivision";
import type { TermName } from "./TermName";

/** 期のどの区切りか(半期の上期、四半期の第3四半期など)。通年は 1 つだけ。 */
export class PeriodPart {
	private constructor(
		readonly division: PeriodDivision,
		/** 1 から。 */
		readonly number: number,
		readonly label: string,
	) {}

	/** division にない番号(半期の 3 番目など)は例外。 */
	static of(division: PeriodDivision, number: number): PeriodPart {
		return new PeriodPart(division, number, division.partLabel(number));
	}

	/** 評価期間の名前。通年は期の名前のまま、分けたときは「26期 上期」。 */
	nameIn(term: TermName): string {
		return this.label ? `${term} ${this.label}` : term.toString();
	}
}
