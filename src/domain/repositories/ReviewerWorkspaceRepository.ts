import type { ReviewerRow } from "../entities/ReviewerWorkspace";

export interface ReviewerWorkspaceRepository {
	load(periodId: number): Promise<ReviewerRow[]>;
	setReviewed(sheetId: number, revision: string, reviewed: boolean): Promise<void>;
}
