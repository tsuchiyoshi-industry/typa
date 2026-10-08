import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { SheetExportDataDto } from "./ExportSheetDto";

function formatScore(score: number | null): string {
	return score == null ? "未評価" : String(score);
}

/**
 * 画面と同じ評価シート(エンティティ)から帳票のデータを作る。点数・配点・ランクの決め方は画面と共通で、
 * 帳票だけ別の計算をしない。帳票は確定した評価の記録で、誰が出力しても同じ内容になる。
 */
export function toSheetExportDataDto(
	sheet: EvaluationSheet,
	gradeName: string,
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
		finalEvaluationRank: sheet.resolveFinalEvaluationRank().toDisplayText(),
		objectiveAllocationScore: scores.objectiveAllocationScore,
		objectiveSecondRate: String(scores.objectiveSecondRate),
		objectiveEvaluationScore: String(scores.objectiveEvaluationScore),
		commonEvaluationAllocationScore: scores.commonEvaluationAllocationScore,
		commonEvaluationSecondRate: String(scores.commonEvaluationSecondRate),
		commonEvaluationEvaluationScore: String(scores.commonEvaluationEvaluationScore),
		totalEvaluationScore: String(scores.totalEvaluationScore),
		firstOverallComment: sheet.firstOverallComment,
		secondOverallComment: sheet.secondOverallComment,
		objectives: sheet.objectives.map((objective) => ({
			id: objective.id,
			goalNumber: objective.goalNumber,
			challengeGoal: objective.challengeGoal,
			midtermGoal: objective.midtermGoal,
			achievement: objective.achievement,
			firstScore: objective.firstScore.toNumber(),
			secondScore: formatScore(primaryIsFinal ? null : objective.secondScore.toNumber()),
		})),
		commonEvaluations: sheet.commonEvaluationResults.map((result) => ({
			itemName: result.item.title,
			itemDescription: result.item.description,
			weight: result.item.weight,
			firstScore: result.firstScore.toNumber(),
			secondScore: formatScore(primaryIsFinal ? null : result.secondScore.toNumber()),
			firstComment: result.firstComment.toString(),
		})),
	};
}
