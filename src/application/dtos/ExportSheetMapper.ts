import type { EvaluationSheetExportData } from "../../domain/repositories/EvaluationSheetRepository";
import type { SheetExportDataDto } from "./ExportSheetDto";

const MASKED_VALUE = "*";

function formatScore(score: number | null, canView: boolean): string {
	if (!canView) {
		return MASKED_VALUE;
	}
	return score == null ? "未評価" : String(score);
}

function maskText(value: string, canView: boolean): string {
	return canView ? value : MASKED_VALUE;
}

function maskNullableText(value: string | null, canView: boolean): string | null {
	if (value == null || canView) {
		return value;
	}
	return MASKED_VALUE;
}

export function toSheetExportDataDto(
	data: EvaluationSheetExportData,
	canViewSecondEvaluation: boolean,
): SheetExportDataDto {
	return {
		sheetId: data.sheetId,
		employeeName: data.employeeName,
		employeeNo: data.employeeNo,
		careerCourse: data.careerCourse,
		gradeName: data.gradeName,
		periodName: data.periodName,
		periodStart: data.periodStart,
		periodEnd: data.periodEnd,
		primaryEvaluator: data.primaryEvaluator,
		secondaryEvaluator: data.secondaryEvaluator,
		status: data.status,
		totalScore: data.totalScore,
		finalEvaluationRank: maskText(data.finalEvaluationRank, canViewSecondEvaluation),
		objectiveAllocationScore: data.objectiveAllocationScore,
		objectiveSecondRate: maskText(String(data.objectiveSecondRate), canViewSecondEvaluation),
		objectiveEvaluationScore: maskText(
			String(data.objectiveEvaluationScore),
			canViewSecondEvaluation,
		),
		commonEvaluationAllocationScore: data.commonEvaluationAllocationScore,
		commonEvaluationSecondRate: maskText(
			String(data.commonEvaluationSecondRate),
			canViewSecondEvaluation,
		),
		commonEvaluationEvaluationScore: maskText(
			String(data.commonEvaluationEvaluationScore),
			canViewSecondEvaluation,
		),
		totalEvaluationScore: maskText(String(data.totalEvaluationScore), canViewSecondEvaluation),
		firstOverallComment: data.firstOverallComment,
		secondOverallComment: maskText(data.secondOverallComment, canViewSecondEvaluation),
		objectives: data.objectives.map((objective) => ({
			id: objective.id,
			goalNumber: objective.goalNumber,
			challengeGoal: objective.challengeGoal,
			midtermGoal: objective.midtermGoal,
			achievement: objective.achievement,
			selfScore: objective.selfScore,
			evaluatorScore: formatScore(objective.evaluatorScore, canViewSecondEvaluation),
		})),
		commonEvaluations: data.commonEvaluations.map((item) => ({
			itemName: item.itemName,
			itemDescription: item.itemDescription,
			weight: item.weight,
			selfScore: item.selfScore,
			evaluatorScore: formatScore(item.evaluatorScore, canViewSecondEvaluation),
			selfComment: item.selfComment,
			evaluatorComment: maskNullableText(item.evaluatorComment, canViewSecondEvaluation),
		})),
	};
}
