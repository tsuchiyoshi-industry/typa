import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { supabase } from "../db/supabase";

export class SupabaseEvaluationSettingsRepository implements EvaluationSettingsRepository {
	async findAllocation(): Promise<EvaluationAllocation> {
		const { data, error } = await supabase
			.from("evaluation_settings")
			.select("objective_allocation, common_allocation")
			.maybeSingle();

		if (error) {
			throw error;
		}
		const row = data as { objective_allocation: number; common_allocation: number } | null;
		if (!row) {
			throw new Error("評価の配点設定が登録されていません。");
		}
		return EvaluationAllocation.of(row.objective_allocation, row.common_allocation);
	}

	async saveAllocation(allocation: EvaluationAllocation): Promise<boolean> {
		const { data, error } = await supabase
			.from("evaluation_settings")
			.update({
				objective_allocation: allocation.objective,
				common_allocation: allocation.common,
				updated_at: new Date().toISOString(),
			})
			.eq("id", true)
			.select("id");

		if (error) {
			throw error;
		}
		// RLSで拒否された更新はエラーにならず0件で返る
		return (data?.length ?? 0) > 0;
	}

	async findMaxChallengeGoals(): Promise<number> {
		const { data, error } = await supabase
			.from("evaluation_settings")
			.select("max_challenge_goals")
			.maybeSingle();

		if (error) {
			throw error;
		}
		const max = (data as { max_challenge_goals: number } | null)?.max_challenge_goals;
		if (!Number.isInteger(max)) {
			throw new Error("チャレンジ目標の上限が登録されていません。");
		}
		return max as number;
	}

	async saveMaxChallengeGoals(max: number): Promise<boolean> {
		const { data, error } = await supabase
			.from("evaluation_settings")
			.update({ max_challenge_goals: max, updated_at: new Date().toISOString() })
			.eq("id", true)
			.select("id");

		if (error) {
			throw error;
		}
		return (data?.length ?? 0) > 0;
	}
}
