import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { EvaluationSheetDto } from "./EvaluationSheetDto";

export function toEvaluationSheetDto(
	sheet: EvaluationSheet,
	gradeName: string,
	policy: EvaluationSheetAccessPolicy,
): EvaluationSheetDto {
	const canViewSecondMilestoneScore = policy.canViewMilestoneSecondScore();
	if (!policy.canViewSheet()) {
		throw new Error("評価シートを閲覧する権限がありません。");
	}
	const canViewCommon = policy.canViewCommonEvaluation();
	const canViewSecond = canViewCommon && policy.canViewCommonEvaluationSecond();
	const canViewFinal = canViewCommon && policy.canViewFinalEvaluation();

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
		primaryIsFinalEvaluator: sheet.primaryIsFinalEvaluator(),
		firstOverallComment: canViewCommon ? sheet.firstOverallComment : "",
		secondOverallComment: canViewSecond ? sheet.secondOverallComment : "",
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
			secondTotalScore: canViewSecondMilestoneScore
				? sheet.objectiveScoreTotals.secondTotalScore
				: null,
			secondTotalRate: canViewSecondMilestoneScore
				? sheet.objectiveScoreTotals.secondTotalRate
				: null,
		},
		commonEvaluationScoreTotals: {
			firstTotalScore: canViewCommon ? sheet.commonEvaluationScoreTotals.firstTotalScore : null,
			firstTotalRate: canViewCommon ? sheet.commonEvaluationScoreTotals.firstTotalRate : null,
			secondTotalScore: canViewSecond ? sheet.commonEvaluationScoreTotals.secondTotalScore : null,
			secondTotalRate: canViewSecond ? sheet.commonEvaluationScoreTotals.secondTotalRate : null,
		},
		allocatedScores: {
			objectiveAllocationScore: sheet.allocatedScores.objectiveAllocationScore,
			objectiveSecondRate:
				canViewSecondMilestoneScore || canViewFinal
					? sheet.allocatedScores.objectiveSecondRate
					: null,
			objectiveEvaluationScore:
				canViewSecondMilestoneScore || canViewFinal
					? sheet.allocatedScores.objectiveEvaluationScore
					: null,
			commonEvaluationAllocationScore: sheet.allocatedScores.commonEvaluationAllocationScore,
			commonEvaluationSecondRate: canViewFinal
				? sheet.allocatedScores.commonEvaluationSecondRate
				: null,
			commonEvaluationEvaluationScore: canViewFinal
				? sheet.allocatedScores.commonEvaluationEvaluationScore
				: null,
			totalEvaluationScore: canViewFinal ? sheet.allocatedScores.totalEvaluationScore : null,
		},
		status: sheet.status.toString(),
		isEditable: sheet.isEditable(),
		...(policy.canConfirmFirstEvaluation() || policy.canFinalizeEvaluation()
			? {
					pendingEvaluationItems: sheet.pendingEvaluationItems(
						policy.canConfirmFirstEvaluation() || sheet.primaryIsFinalEvaluator()
							? "first"
							: "second",
					),
				}
			: {}),
		firstEvaluationRank: canViewCommon
			? {
					displayText: sheet.resolveFirstEvaluationRank().toDisplayText(),
					score: sheet.firstEvaluationScore(),
					confirmed: sheet.status.isFirstEvaluationConfirmed(),
				}
			: undefined,
		finalEvaluationRank: canViewFinal
			? {
					displayText: sheet.resolveFinalEvaluationRank().toDisplayText(),
					score: sheet.allocatedScores.totalEvaluationScore,
					confirmed: sheet.status.isFinalized(),
				}
			: undefined,
	};
}
