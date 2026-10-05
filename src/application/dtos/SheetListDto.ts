export interface SheetSummaryDto {
	id: number;
	periodId: number;
	employeeId: number;
	status: string;
	/** List rows do not resolve per-sheet secondary permissions. Do not expose a derived score. */
	totalScore: null;
	createdAt: string;
	updatedAt: string;
	periodName: string;
	startDate: string;
	endDate: string;
	employeeName: string;
	employeeNo: string;
}

export interface CategorizedSheetsDto {
	mySheets: SheetSummaryDto[];
	subordinateSheets: SheetSummaryDto[];
}
