import type {
	CommonEvaluationDraft,
	CommonEvaluationRepository,
} from "../repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../repositories/EvaluationSheetRepository";
import { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";

export async function createSheetWithCommonEvaluation(
	periodId: number,
	employeeId: number,
	drafts: CommonEvaluationDraft[],
	evaluationSheetRepository: EvaluationSheetRepository,
	commonEvaluationRepository: CommonEvaluationRepository,
): Promise<number> {
	const sheetId = await evaluationSheetRepository.createOrGetSheet(periodId, employeeId);
	await commonEvaluationRepository.createResultsForSheet(sheetId, drafts);
	const sheet = await evaluationSheetRepository.findById(sheetId);
	if (sheet) {
		const commonEvaluationScoreTotals = EvaluationScoreTotals.fromCommonEvaluationResults(
			sheet.commonEvaluationResults,
		);
		await evaluationSheetRepository.updateScoreTotals(sheetId, {
			commonEvaluationResults: commonEvaluationScoreTotals,
			allocatedScores: EvaluationAllocatedScores.fromTotals(
				sheet.objectiveScoreTotals,
				commonEvaluationScoreTotals,
			),
		});
	}
	return sheetId;
}
