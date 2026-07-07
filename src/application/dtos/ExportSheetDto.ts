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
	/** 二次評価者以外が出力する場合、伏せ字("*")になる。 */
	finalEvaluationRank: string;
	objectiveAllocationScore: number;
	/** 二次評価の点数から算出されるため、二次評価者以外が出力する場合は伏せ字("*")になる。 */
	objectiveSecondRate: string;
	/** 二次評価の点数から算出されるため、二次評価者以外が出力する場合は伏せ字("*")になる。 */
	objectiveEvaluationScore: string;
	commonEvaluationAllocationScore: number;
	/** 二次評価の点数から算出されるため、二次評価者以外が出力する場合は伏せ字("*")になる。 */
	commonEvaluationSecondRate: string;
	/** 二次評価の点数から算出されるため、二次評価者以外が出力する場合は伏せ字("*")になる。 */
	commonEvaluationEvaluationScore: string;
	/** 二次評価の点数から算出されるため、二次評価者以外が出力する場合は伏せ字("*")になる。 */
	totalEvaluationScore: string;
	firstOverallComment: string;
	/** 二次評価者以外が出力する場合、伏せ字("*")になる。 */
	secondOverallComment: string;
	objectives: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		selfScore: number | null;
		/** 二次評価者以外が出力する場合、伏せ字("*")になる。 */
		evaluatorScore: string;
	}[];
	commonEvaluations: {
		itemName: string;
		itemDescription: string;
		weight: number;
		selfScore: number | null;
		/** 二次評価者以外が出力する場合、伏せ字("*")になる。 */
		evaluatorScore: string;
		selfComment: string | null;
		/** 二次評価者以外が出力する場合、伏せ字("*")になる。 */
		evaluatorComment: string | null;
	}[];
}
