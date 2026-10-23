import type { DateRange } from "../valueObjects/DateRange";
import type { PeriodPart } from "../valueObjects/PeriodPart";
import type { TermName } from "../valueObjects/TermName";

/** これから保存する評価期間(追加する、または変える内容)。保存すると EvaluationPeriod になる。 */
export class EvaluationPeriodPlan {
	constructor(
		readonly term: TermName,
		readonly part: PeriodPart,
		readonly range: DateRange,
		/** 評価が確定していないシートが残っていても締めてよいか(Admin が決める)。 */
		readonly allowUnfinalizedClose: boolean,
	) {}

	/** 「26期」「26期 上期」。評価期間の名前は期の名前と区切りから決まり、別には付けない。 */
	get periodName(): string {
		return this.part.nameIn(this.term);
	}
}
