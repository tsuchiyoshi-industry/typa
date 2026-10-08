import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
export interface SheetSummaryDto {
	id: number;
	periodId: number;
	employeeId: number;
	status: EvaluationStatusValue;
	/** List rows do not resolve per-sheet secondary permissions. Do not expose a derived score. */
	totalScore: null;
	createdAt: string;
	updatedAt: string;
	periodName: string;
	startDate: string;
	endDate: string;
	employeeName: string;
	employeeNo: string;
	/** シートを作成したときの等級。社員の等級は変わっていくので、今の等級ではない。 */
	gradeName: string;
}

/** 全社の評価シート一覧(Admin)の1行。進み具合と評価者だけで、評価の内容は持たない。 */
export interface SheetOverviewDto extends SheetSummaryDto {
	primaryEvaluator: string;
	secondaryEvaluator: string;
}

export interface CategorizedSheetsDto {
	mySheets: SheetSummaryDto[];
	subordinateSheets: SheetSummaryDto[];
}
