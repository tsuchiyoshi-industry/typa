import type {
	CommonEvaluationDraft,
	CommonEvaluationRepository,
} from "../repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../repositories/EvaluationSheetRepository";

export async function createSheetWithCommonEvaluation(
	periodId: number,
	employeeId: number,
	drafts: CommonEvaluationDraft[],
	evaluationSheetRepository: EvaluationSheetRepository,
	commonEvaluationRepository: CommonEvaluationRepository,
): Promise<number> {
	const sheetId = await evaluationSheetRepository.createOrGetSheet(periodId, employeeId);
	await commonEvaluationRepository.createResultsForSheet(sheetId, drafts);
	return sheetId;
}
