import type { CommonEvaluationItem } from "../entities/CommonEvaluationItem";
import type { CommonEvaluationResult } from "../entities/CommonEvaluationResult";

export interface CommonEvaluationDraft {
	itemId: number;
	firstComment: string;
	firstScore: number;
	secondScore: number;
}

export interface CommonEvaluationResultPayload {
	id: number;
	itemId: number;
	firstComment: string;
	firstScore: number;
	secondScore: number;
}

export interface CommonEvaluationRepository {
	findItemsByGrade(gradeId: number | null): Promise<CommonEvaluationItem[]>;
	findResultsBySheetId(
		sheetId: number,
		gradeId: number | null,
	): Promise<{
		results: CommonEvaluationResult[];
		totalFirstScore: number;
		totalSecondScore: number;
		totalWeight: number;
		firstRate: number;
		secondRate: number;
	}>;
	createResultsForSheet(sheetId: number, drafts: CommonEvaluationDraft[]): Promise<void>;
	upsertResults(
		sheetId: number,
		results: CommonEvaluationResultPayload[],
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<void>;
}
