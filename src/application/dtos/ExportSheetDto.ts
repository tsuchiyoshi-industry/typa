import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
export interface ExportSheetRequestDto {
	sheetId: number;
	employeeId: number;
	periodId: number;
	currentEmployeeId: number;
}

export interface ExportSheetOutputDto {
	success: boolean;
	message: string;
	fileName?: string;
}

/** 全社の評価シート一覧の帳票。1つの評価期間の全シートの進み具合と、確定した結果。 */
export interface SheetOverviewExportDto {
	periodName: string;
	periodStart: string;
	periodEnd: string;
	/** 出力した日時と人。表示用の文字列。 */
	issuedAt: string;
	issuedBy: string;
	/** 社員番号順。状態の表示名は帳票のテンプレートが持つ。 */
	rows: {
		employeeNo: string;
		employeeName: string;
		gradeName: string;
		status: EvaluationStatusValue;
		primaryEvaluator: string;
		secondaryEvaluator: string;
		/** 確定した評価点と最終評価ランク(「88 点 A」)。確定前は空文字。 */
		finalEvaluation: string;
		updatedAt: string;
	}[];
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
	/** true の場合(二次評価者「なし」)、一次評価者が最終評価者を兼ねる。帳票の「最終評価ランク」の決定者表記に使う。 */
	primaryIsFinalEvaluator: boolean;
	status: EvaluationStatusValue;
	finalEvaluationRank: string;
	objectiveAllocationScore: number;
	objectiveSecondRate: string;
	objectiveEvaluationScore: string;
	commonEvaluationAllocationScore: number;
	commonEvaluationSecondRate: string;
	commonEvaluationEvaluationScore: string;
	totalEvaluationScore: string;
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		/** 一次評価の点数。 */
		firstScore: number | null;
		/** 二次評価の点数。二次評価者「なし」のシートは「未評価」。 */
		secondScore: string;
	}[];
	commonEvaluations: {
		itemName: string;
		itemDescription: string;
		weight: number;
		/** 一次評価の点数。 */
		firstScore: number | null;
		/** 二次評価の点数。二次評価者「なし」のシートは「未評価」。 */
		secondScore: string;
		/** 一次評価者のコメント。 */
		firstComment: string | null;
	}[];
}
