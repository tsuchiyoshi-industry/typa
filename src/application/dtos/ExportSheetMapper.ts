import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
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

/**
 * 画面と同じ評価シート(エンティティ)から帳票のデータを作る。点数・配点・ランクの決め方は画面と共通で、
 * 帳票だけ別の計算をしない。canViewSecondEvaluation が false の場合、二次評価から決まる値は伏せ字にする。
 */
export function toSheetExportDataDto(
	sheet: EvaluationSheet,
	gradeName: string,
	canViewSecondEvaluation: boolean,
): SheetExportDataDto {
	// 二次評価者「なし」の社員は二次評価の点数がなく、一次評価が最終評価になる
	const primaryIsFinal = sheet.primaryIsFinalEvaluator();
	const scores = sheet.allocatedScores;
	return {
		sheetId: sheet.sheetId,
		employeeName: sheet.subject.name,
		employeeNo: sheet.subject.employeeNo,
		careerCourse: sheet.subject.careerCourse ?? "",
		gradeName,
		periodName: sheet.evaluationPeriod.periodName,
		periodStart: sheet.evaluationPeriod.startDate,
		periodEnd: sheet.evaluationPeriod.endDate,
		primaryEvaluator: sheet.primaryEvaluatorName,
		secondaryEvaluator: sheet.secondaryEvaluatorName,
		primaryIsFinalEvaluator: primaryIsFinal,
		status: sheet.status.toString(),
		finalEvaluationRank: maskText(
			sheet.resolveFinalEvaluationRank().toDisplayText(),
			canViewSecondEvaluation,
		),
		objectiveAllocationScore: scores.objectiveAllocationScore,
		objectiveSecondRate: maskText(String(scores.objectiveSecondRate), canViewSecondEvaluation),
		objectiveEvaluationScore: maskText(
			String(scores.objectiveEvaluationScore),
			canViewSecondEvaluation,
		),
		commonEvaluationAllocationScore: scores.commonEvaluationAllocationScore,
		commonEvaluationSecondRate: maskText(
			String(scores.commonEvaluationSecondRate),
			canViewSecondEvaluation,
		),
		commonEvaluationEvaluationScore: maskText(
			String(scores.commonEvaluationEvaluationScore),
			canViewSecondEvaluation,
		),
		totalEvaluationScore: maskText(String(scores.totalEvaluationScore), canViewSecondEvaluation),
		firstOverallComment: sheet.firstOverallComment,
		secondOverallComment: maskText(sheet.secondOverallComment, canViewSecondEvaluation),
		objectives: sheet.objectives.map((objective) => ({
			id: objective.id,
			goalNumber: objective.goalNumber,
			challengeGoal: objective.challengeGoal,
			midtermGoal: objective.midtermGoal,
			achievement: objective.achievement,
			selfScore: objective.firstScore.toNumber(),
			evaluatorScore: formatScore(
				primaryIsFinal ? null : objective.secondScore.toNumber(),
				canViewSecondEvaluation,
			),
		})),
		commonEvaluations: sheet.commonEvaluationResults.map((result) => ({
			itemName: result.item.title,
			itemDescription: result.item.description,
			weight: result.item.weight,
			selfScore: result.firstScore.toNumber(),
			evaluatorScore: formatScore(
				primaryIsFinal ? null : result.secondScore.toNumber(),
				canViewSecondEvaluation,
			),
			selfComment: result.firstComment.toString(),
			// 共通評価に評価者のコメント欄はない
			evaluatorComment: null,
		})),
	};
}
