export interface SheetSummaryDto {
	id: number;
	periodId: number;
	employeeId: number;
	status: string;
	totalScore: number;
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
