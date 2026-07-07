export interface CommonEvaluationItemDto {
	id: number;
	title: string;
	description: string;
	weight: number;
	gradeId: number | null;
}

export interface CommonEvaluationResultDto {
	id: number;
	sheetId: number;
	itemId: number;
	firstScore: number;
	/** 一次評価者からは伏せられるため null になり得る。 */
	secondScore: number | null;
	firstComment: string;
	item: CommonEvaluationItemDto;
}

export interface CommonEvaluationSummaryDto {
	results: CommonEvaluationResultDto[];
	totalFirstScore: number;
	/** 一次評価者からは伏せられるため null になり得る。 */
	totalSecondScore: number | null;
	totalWeight: number;
	firstRate: number;
	/** 一次評価者からは伏せられるため null になり得る。 */
	secondRate: number | null;
}
