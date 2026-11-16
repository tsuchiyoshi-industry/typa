import type { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";

/** データ取込で選べる評価期間(実施中か締め済み)。 */
export interface SheetImportPeriodDto {
	id: number;
	periodName: string;
	/** 「実施中」「締め済み」。 */
	stateLabel: string;
	/** 締めを越えて書くので、取り込む前に確かめる(締め済み)。 */
	needsConfirmation: boolean;
}

export const toSheetImportPeriodDto = (period: EvaluationPeriod): SheetImportPeriodDto => ({
	id: period.id,
	periodName: period.periodName,
	stateLabel: period.state.label,
	needsConfirmation: period.importNeedsConfirmation(),
});
