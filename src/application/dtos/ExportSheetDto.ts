export interface ExportSheetRequestDto {
	sheetId: number;
	employeeId: number;
	periodId: number;
}

export interface ExportSheetOutputDto {
	success: boolean;
	message: string;
	fileName?: string;
}

export interface SheetExportDataDto {
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
	finalEvaluationRank: string;
	objectiveAllocationScore: number;
	objectiveSecondRate: number;
	objectiveEvaluationScore: number;
	commonEvaluationAllocationScore: number;
	commonEvaluationSecondRate: number;
	commonEvaluationEvaluationScore: number;
	totalEvaluationScore: number;
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
