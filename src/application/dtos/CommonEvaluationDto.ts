export interface CommonEvaluationItemDto {
	id: number;
	title: string;
	description: string;
	/** 配点。評価(1〜4)に掛ける係数で、その項目の得点は「配点 × 評価」。 */
	weight: number;
	itemSetId: number | null;
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
	/** 「配点 × 評価」の合計。満点は totalWeight × 4。 */
	totalFirstScore: number;
	/** 一次評価者からは伏せられるため null になり得る。 */
	totalSecondScore: number | null;
	totalWeight: number;
	firstRate: number;
	/** 一次評価者からは伏せられるため null になり得る。 */
	secondRate: number | null;
}
