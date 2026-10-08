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

/** 全社の評価シート一覧(Admin)の1行。進み具合と評価者、確定していればその結果。 */
export interface SheetOverviewDto extends SheetSummaryDto {
	primaryEvaluator: string;
	secondaryEvaluator: string;
	/** 確定した評価点と最終評価ランク。確定前は null。 */
	finalScore: number | null;
	finalRank: string | null;
}

export interface CategorizedSheetsDto {
	mySheets: SheetSummaryDto[];
	subordinateSheets: SheetSummaryDto[];
}
