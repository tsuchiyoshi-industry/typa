import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { SheetCorrection } from "../../domain/entities/SheetCorrection";
import type { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { toEvaluationPeriodDto } from "./EvaluationPeriodDto";
import type { EvaluationSheetDto, SheetCorrectionDto } from "./EvaluationSheetDto";

export function toEvaluationSheetDto(
	sheet: EvaluationSheet,
	gradeName: string,
	policy: EvaluationSheetAccessPolicy,
): EvaluationSheetDto {
	const canViewFirstMilestoneScore = policy.canViewMilestoneFirstScore();
	const canViewSecondMilestoneScore = policy.canViewMilestoneSecondScore();
	if (!policy.canViewSheet()) {
		throw new Error("評価シートを閲覧する権限がありません。");
	}
	const canViewCommon = policy.canViewCommonEvaluation();
	const canViewRanks = policy.canViewEvaluationRanks();
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
		evaluationPeriod: toEvaluationPeriodDto(sheet.evaluationPeriod),
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
			periodGoals: objective.periodGoals,
			achievement: objective.achievement,
			firstScore: canViewFirstMilestoneScore ? objective.firstScore.toNumber() : null,
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
			firstTotalScore: canViewFirstMilestoneScore
				? sheet.objectiveScoreTotals.firstTotalScore
				: null,
			firstTotalRate: canViewFirstMilestoneScore ? sheet.objectiveScoreTotals.firstTotalRate : null,
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
		notifiesByMail: sheet.notifiesByMail,
		goalReturnReason: sheet.goalReturnReason,
		currentHolder: sheet.currentHolder(),
		corrections: sheet.corrections
			.filter((correction) => policy.canViewCorrection(correction))
			.map(toSheetCorrectionDto),
		pendingObjectiveFields: sheet.pendingObjectiveFields(),
		permissions: {
			viewsAsAdmin: policy.viewsAsAdmin(),
			isSubject: policy.isSubject(),
			canEditFirst: policy.canEditCommonEvaluationFirst(),
			canEditSecond: policy.canEditCommonEvaluationSecond(),
			canEditMilestoneGoal: policy.canEditMilestoneGoal(),
			canViewCommonEvaluation: canViewCommon,
			canViewSecondEvaluation: policy.canViewCommonEvaluationSecond(),
			canEditMilestoneAchievement: policy.canEditMilestoneAchievement(),
			canCarryOverGoal: policy.canCarryOverGoal(),
			canConfirmGoals: policy.canConfirmGoals(),
			canRequestFirstEvaluation: policy.canRequestFirstEvaluation(),
			canSubmitGoals: policy.canSubmitGoals(),
			canReturnGoalsToDraft: policy.canReturnGoalsToDraft(),
			canConfirmFirstEvaluation: policy.canConfirmFirstEvaluation(),
			canFinalizeEvaluation: policy.canFinalizeEvaluation(),
			canResendNotification: policy.canResendNotification(),
		},
		...(policy.canConfirmFirstEvaluation() || policy.canFinalizeEvaluation()
			? {
					pendingEvaluationItems: sheet.pendingEvaluationTargets(
						sheet.confirmingStage(
							policy.canConfirmFirstEvaluation()
								? EvaluationStatus.FIRST_EVALUATED
								: EvaluationStatus.FINALIZED,
						),
					),
				}
			: {}),
		firstEvaluationRank:
			canViewCommon && canViewRanks
				? {
						displayText: sheet.resolveFirstEvaluationRank().toDisplayText(),
						score: sheet.firstEvaluationScore(),
						confirmed: sheet.status.isFirstEvaluationConfirmed(),
					}
				: undefined,
		finalEvaluationRank:
			canViewFinal && canViewRanks
				? {
						displayText: sheet.resolveFinalEvaluationRank().toDisplayText(),
						score: sheet.allocatedScores.totalEvaluationScore,
						confirmed: sheet.status.isFinalized(),
					}
				: undefined,
	};
}

export const toSheetCorrectionDto = (correction: SheetCorrection): SheetCorrectionDto => ({
	id: correction.id,
	subject: correction.subject,
	before: correction.beforeText,
	after: correction.afterText,
	reason: correction.reason,
	correctedAt: correction.correctedAt,
});
