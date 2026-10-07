import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import type { ReviewerWorkspaceRepository } from "../../domain/repositories/ReviewerWorkspaceRepository";
import { supabase } from "../db/supabase";

export class SupabaseReviewerWorkspaceRepository implements ReviewerWorkspaceRepository {
	async load(periodId: number): Promise<ReviewerRowDto[]> {
		const { data, error } = await supabase.rpc("get_reviewer_workspace", { p_period_id: periodId });
		if (error) {
			throw error;
		}
		return (data ?? []) as ReviewerRowDto[];
	}

	async setReviewed(sheetId: number, revision: string, reviewed: boolean): Promise<void> {
		const { error } = await supabase.rpc("set_sheet_reviewed", {
			p_sheet_id: sheetId,
			p_revision: revision,
			p_reviewed: reviewed,
		});
		if (error) {
			throw error;
		}
	}
}
