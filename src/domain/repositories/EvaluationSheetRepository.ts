import type { EvaluationSheet } from "../entities/EvaluationSheet";

export interface EvaluationSheetSummary {
	id: number;
	periodId: number;
	employeeId: number;
	status: string;
	totalScore: number;
	createdAt: string;
	updatedAt: string;
	periodName: string;
	periodStart: string;
	periodEnd: string;
	employeeName: string;
	employeeNo: string;
}

export interface EvaluationSheetExportData {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	careerCourse: string;
	gradeName: string;
	periodName: string;
	periodStart: string;
	periodEnd: string;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	status: string;
	totalScore: number;
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		selfScore: number | null;
		evaluatorScore: number | null;
	}[];
	commonEvaluations: {
		itemName: string;
		itemDescription: string;
		weight: number;
		selfScore: number | null;
		evaluatorScore: number | null;
		selfComment: string | null;
		evaluatorComment: string | null;
	}[];
}

export interface EvaluationSheetRepository {
	findById(sheetId: number): Promise<EvaluationSheet | null>;
	createOrGetSheet(periodId: number, employeeId: number): Promise<number>;
	updateOverallComment(
		sheetId: number,
		target: "first" | "second",
		comment: string,
	): Promise<EvaluationSheet>;
	findByOwner(employeeId: number): Promise<EvaluationSheetSummary[]>;
	findByEmployeeIds(employeeIds: number[]): Promise<EvaluationSheetSummary[]>;
	findExportData(sheetId: number): Promise<EvaluationSheetExportData | null>;
}
