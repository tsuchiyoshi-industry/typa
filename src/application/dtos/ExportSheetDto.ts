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
