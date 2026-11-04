import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { SheetExportDataDto } from "./ExportSheetDto";

function formatScore(score: number | null): string {
	return score == null ? "未評価" : String(score);
}

/**
 * 画面と同じ評価シート(エンティティ)から帳票のデータを作る。点数・配点・ランクの決め方は画面と共通で、
 * 帳票だけ別の計算をしない。帳票には、出力する人が見られる範囲だけを入れる(policy)。
 * 最終評価を見られない一次評価者の帳票は、二次評価と最終評価を伏せ、その値をデータにも入れない。
 */
export function toSheetExportDataDto(
	sheet: EvaluationSheet,
	gradeName: string,
	policy: EvaluationSheetAccessPolicy,
): SheetExportDataDto {
	// 二次評価者「なし」の社員は二次評価の点数がなく、一次評価が最終評価になる
	const primaryIsFinal = sheet.primaryIsFinalEvaluator();
	const hidesFinal = !policy.canViewFinalEvaluation();
	const scores = sheet.allocatedScores;
	const final = (value: string) => (hidesFinal ? "" : value);
	const secondScore = (value: number) =>
		hidesFinal ? "" : formatScore(primaryIsFinal ? null : value);
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
		finalEvaluationRank: final(sheet.resolveFinalEvaluationRank().toDisplayText()),
		objectiveAllocationScore: scores.objectiveAllocationScore,
		objectiveSecondRate: final(String(scores.objectiveSecondRate)),
		objectiveEvaluationScore: final(String(scores.objectiveEvaluationScore)),
		commonEvaluationAllocationScore: scores.commonEvaluationAllocationScore,
		commonEvaluationSecondRate: final(String(scores.commonEvaluationSecondRate)),
		commonEvaluationEvaluationScore: final(String(scores.commonEvaluationEvaluationScore)),
		totalEvaluationScore: final(String(scores.totalEvaluationScore)),
		firstOverallComment: sheet.firstOverallComment,
		secondOverallComment: hidesFinal ? "" : sheet.secondOverallComment,
		// 確定前のシートを出力できるのは、評価を確定せずに締めた期間だけ(EvaluationSheetAccessPolicy)
		unconfirmed: !sheet.status.isFinalized(),
		hidesFinal,
		// 締め後修正は、直した項目を見られるものだけ(一次評価者の帳票に二次評価の修正は載せない)
		corrections: sheet.corrections
			.filter((correction) => policy.canViewCorrection(correction))
			.filter((correction) => sheet.status.isFinalized() || correction.stage === "content")
			.map(
				(correction) =>
					`${correction.correctedAt.slice(0, 10)} ${correction.subject}: ${correction.beforeText} → ${correction.afterText}(理由: ${correction.reason})`,
			),
		objectives: sheet.objectives.map((objective) => ({
			id: objective.id,
			goalNumber: objective.goalNumber,
			challengeGoal: objective.challengeGoal,
			periodGoals: objective.periodGoals,
			achievement: objective.achievement,
			firstScore: objective.firstScore.toNumber(),
			secondScore: secondScore(objective.secondScore.toNumber()),
		})),
		commonEvaluations: sheet.commonEvaluationResults.map((result) => ({
			itemName: result.item.title,
			itemDescription: result.item.description,
			weight: result.item.weight,
			firstScore: result.firstScore.toNumber(),
			secondScore: secondScore(result.secondScore.toNumber()),
			firstComment: result.firstComment.toString(),
		})),
	};
}
