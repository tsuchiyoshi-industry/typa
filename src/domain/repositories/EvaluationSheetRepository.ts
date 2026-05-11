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
	periodName: string;
	periodStart: string;
	periodEnd: string;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	status: string;
	totalScore: number;
	objectives: {
		id: number;
		title: string;
		description: string;
		targetDate: string;
		status: string;
		selfScore: number | null;
		evaluatorScore: number | null;
		selfComment: string | null;
		evaluatorComment: string | null;
	}[];
	commonEvaluations: {
		itemName: string;
		selfScore: number | null;
		evaluatorScore: number | null;
		selfComment: string | null;
		evaluatorComment: string | null;
	}[];
}

export interface EvaluationSheetRepository {
	findById(sheetId: number): Promise<EvaluationSheet | null>;
	createOrGetSheet(periodId: number, employeeId: number): Promise<number>;
	findByOwner(employeeId: number): Promise<EvaluationSheetSummary[]>;
	findByEmployeeIds(employeeIds: number[]): Promise<EvaluationSheetSummary[]>;
	findExportData(sheetId: number): Promise<EvaluationSheetExportData | null>;
}
