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
	secondScore: number;
	firstComment: string;
	item: CommonEvaluationItemDto;
}

export interface CommonEvaluationSummaryDto {
	results: CommonEvaluationResultDto[];
	totalFirstScore: number;
	totalSecondScore: number;
	totalWeight: number;
	firstRate: number;
	secondRate: number;
}
