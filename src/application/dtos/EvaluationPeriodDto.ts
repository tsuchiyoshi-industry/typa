import type { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import type { PeriodStateValue } from "../../domain/valueObjects/PeriodState";

export interface EvaluationPeriodDto {
	id: number;
	/** 「26期 上期」。期の名前と区切りから決まる。 */
	periodName: string;
	/** 「26期」。同じ期の評価期間(上期と下期など)は同じ名前。 */
	termName: string;
	startDate: string;
	endDate: string;
	isActive: boolean;
	/** 未開始・実施中・締め済み。開始できるのは未開始だけ。 */
	state: PeriodStateValue;
	/** 「未開始」「実施中」「締め済み」。 */
	stateLabel: string;
	allowUnfinalizedClose: boolean;
}

export const toEvaluationPeriodDto = (period: EvaluationPeriod): EvaluationPeriodDto => ({
	id: period.id,
	periodName: period.periodName,
	termName: period.term.toString(),
	startDate: period.startDate,
	endDate: period.endDate,
	isActive: period.isActive,
	state: period.state.toString(),
	stateLabel: period.state.label,
	allowUnfinalizedClose: period.allowUnfinalizedClose,
});
