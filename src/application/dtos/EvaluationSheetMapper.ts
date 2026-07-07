import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { EvaluationSheetDto } from "./EvaluationSheetDto";

export function toEvaluationSheetDto(
	sheet: EvaluationSheet,
	gradeName: string,
	policy: EvaluationSheetAccessPolicy,
): EvaluationSheetDto {
	const canViewSecondMilestoneScore = policy.canViewMilestoneSecondScore();

	return {
		sheetId: sheet.sheetId,
		subject: {
			id: sheet.subject.id,
			name: sheet.subject.name,
			employeeNo: sheet.subject.employeeNo,
			roleId: sheet.subject.roleId,
			careerCourse: sheet.subject.careerCourse,
			gradeId: sheet.subject.gradeId,
			primaryEvaluatorId: sheet.subject.primaryEvaluatorId,
			secondaryEvaluatorId: sheet.subject.secondaryEvaluatorId,
			gradeName,
		},
		evaluationPeriod: {
			id: sheet.evaluationPeriod.id,
			periodName: sheet.evaluationPeriod.periodName,
			startDate: sheet.evaluationPeriod.startDate,
			endDate: sheet.evaluationPeriod.endDate,
			isActive: sheet.evaluationPeriod.isActive,
		},
		primaryEvaluator: sheet.primaryEvaluatorName,
		secondaryEvaluator: sheet.secondaryEvaluatorName,
		firstOverallComment: sheet.firstOverallComment,
		secondOverallComment: sheet.secondOverallComment,
		objectives: sheet.objectives.map((objective) => ({
			id: objective.id,
			sheetId: objective.sheetId,
			goalNumber: objective.goalNumber,
			challengeGoal: objective.challengeGoal,
			midtermGoal: objective.midtermGoal,
			achievement: objective.achievement,
			firstScore: objective.firstScore.toNumber(),
			secondScore: canViewSecondMilestoneScore ? objective.secondScore.toNumber() : null,
		})),
		objectiveScoreTotals: {
			firstTotalScore: sheet.objectiveScoreTotals.firstTotalScore,
			firstTotalRate: sheet.objectiveScoreTotals.firstTotalRate,
			secondTotalScore: sheet.objectiveScoreTotals.secondTotalScore,
			secondTotalRate: sheet.objectiveScoreTotals.secondTotalRate,
		},
		commonEvaluationScoreTotals: {
			firstTotalScore: sheet.commonEvaluationScoreTotals.firstTotalScore,
			firstTotalRate: sheet.commonEvaluationScoreTotals.firstTotalRate,
			secondTotalScore: sheet.commonEvaluationScoreTotals.secondTotalScore,
			secondTotalRate: sheet.commonEvaluationScoreTotals.secondTotalRate,
		},
		allocatedScores: {
			objectiveAllocationScore: sheet.allocatedScores.objectiveAllocationScore,
			objectiveSecondRate: sheet.allocatedScores.objectiveSecondRate,
			objectiveEvaluationScore: sheet.allocatedScores.objectiveEvaluationScore,
			commonEvaluationAllocationScore: sheet.allocatedScores.commonEvaluationAllocationScore,
			commonEvaluationSecondRate: sheet.allocatedScores.commonEvaluationSecondRate,
			commonEvaluationEvaluationScore: sheet.allocatedScores.commonEvaluationEvaluationScore,
			totalEvaluationScore: sheet.allocatedScores.totalEvaluationScore,
		},
		status: sheet.status.toString(),
		isEditable: sheet.isEditable(),
		finalEvaluationRank: sheet.finalEvaluationRank
			? {
					letter: sheet.finalEvaluationRank.letter,
					level: sheet.finalEvaluationRank.level,
					displayText: sheet.finalEvaluationRank.toDisplayText(),
				}
			: undefined,
	};
}
