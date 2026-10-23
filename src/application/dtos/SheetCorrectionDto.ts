import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { SheetCorrectionDto } from "./EvaluationSheetDto";
import { toSheetCorrectionDto } from "./EvaluationSheetMapper";

/** 遡及処理の画面に出す、締めたシートの中身(Admin はすべて見る)。 */
export interface CorrectableSheetDto {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
	status: string;
	/** 二次評価者を置かないシート。二次評価点は無い。 */
	primaryIsFinalEvaluator: boolean;
	goals: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		firstScore: number;
		secondScore: number;
	}[];
	commonItems: {
		itemId: number;
		title: string;
		firstScore: number;
		secondScore: number;
		firstComment: string;
	}[];
	firstOverallComment: string;
	secondOverallComment: string;
	/** これまでの締め後修正。古い順。 */
	corrections: SheetCorrectionDto[];
}

export const toCorrectableSheetDto = (sheet: EvaluationSheet): CorrectableSheetDto => ({
	sheetId: sheet.sheetId,
	employeeName: sheet.subject.name,
	employeeNo: sheet.subject.employeeNo,
	periodName: sheet.evaluationPeriod.periodName,
	status: sheet.status.toString(),
	primaryIsFinalEvaluator: sheet.primaryIsFinalEvaluator(),
	goals: sheet.objectives.map((goal) => ({
		id: goal.id,
		goalNumber: goal.goalNumber,
		challengeGoal: goal.challengeGoal,
		midtermGoal: goal.midtermGoal,
		achievement: goal.achievement,
		firstScore: goal.firstScore.toNumber(),
		secondScore: goal.secondScore.toNumber(),
	})),
	commonItems: sheet.commonEvaluationResults.map((result) => ({
		itemId: result.item.id,
		title: result.item.title,
		firstScore: result.firstScore.toNumber(),
		secondScore: result.secondScore.toNumber(),
		firstComment: result.firstComment.toString(),
	})),
	firstOverallComment: sheet.firstOverallComment,
	secondOverallComment: sheet.secondOverallComment,
	corrections: sheet.corrections.map(toSheetCorrectionDto),
});
