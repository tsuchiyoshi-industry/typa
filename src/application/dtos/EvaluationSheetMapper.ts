import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
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
	const commonTotals = EvaluationScoreTotals.fromCommonEvaluationResults(
		sheet.commonEvaluationResults,
	);

	return {
		sheetId: sheet.sheetId,
		subject: {
			id: sheet.subject.id,
			name: sheet.subject.name,
			employeeNo: sheet.subject.employeeNo,
			roleId: sheet.subject.roleId,
			careerCourse: sheet.subject.careerCourse,
			// 等級はシート作成時のもの(gradeName と同じ)
			gradeId: sheet.gradeId,
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
		maxObjectives: sheet.maxObjectives,
		// 項目はシート作成時の等級のもの。合計は「配点 × 評価」で、満点は totalWeight × 4
		commonEvaluation: canViewCommon
			? {
					results: sheet.commonEvaluationResults.map((result) => ({
						id: result.id,
						sheetId: result.sheetId,
						itemId: result.itemId,
						firstScore: result.firstScore.toNumber(),
						secondScore: canViewSecond ? result.secondScore.toNumber() : null,
						firstComment: result.firstComment.toString(),
						item: {
							id: result.item.id,
							title: result.item.title,
							description: result.item.description,
							weight: result.item.weight,
							itemSetId: result.item.itemSetId,
						},
					})),
					totalFirstScore: commonTotals.firstTotalScore,
					totalSecondScore: canViewSecond ? commonTotals.secondTotalScore : null,
					totalWeight: sheet.commonEvaluationResults.reduce(
						(sum, result) => sum + result.item.weight,
						0,
					),
					firstRate: commonTotals.firstTotalRate,
					secondRate: canViewSecond ? commonTotals.secondTotalRate : null,
				}
			: null,
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
		permissions: {
			isSubject: policy.isSubject(),
			canEditFirst: policy.canEditCommonEvaluationFirst(),
			canEditSecond: policy.canEditCommonEvaluationSecond(),
			canEditMilestoneGoal: policy.canEditMilestoneGoal(),
			canViewCommonEvaluation: canViewCommon,
			canViewSecondEvaluation: policy.canViewCommonEvaluationSecond(),
			canSubmitOwnSheet: policy.canSubmitOwnSheet(),
			canRevertOwnSheetToDraft: policy.canRevertOwnSheetToDraft(),
			canConfirmFirstEvaluation: policy.canConfirmFirstEvaluation(),
			canFinalizeEvaluation: policy.canFinalizeEvaluation(),
		},
		...(policy.canConfirmFirstEvaluation() || policy.canFinalizeEvaluation()
			? {
					pendingEvaluationItems: sheet.pendingEvaluationTargets(
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
