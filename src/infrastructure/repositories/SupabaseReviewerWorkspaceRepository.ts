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
}
