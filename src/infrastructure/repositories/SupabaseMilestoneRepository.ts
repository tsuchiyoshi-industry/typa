import type {
	MilestoneRepository,
	PreviousGoals,
} from "../../domain/repositories/MilestoneRepository";
import type { PeriodGoal } from "../../domain/valueObjects/PeriodGoal";
import { supabase } from "../db/supabase";

/** 書き込めた行が無い(DB の権限で拒否された)ときは、エラーとして扱う。 */
function requireSaved(result: { data: unknown; error: Error | null }, message: string): void {
	if (result.error || !result.data) {
		throw result.error ?? new Error(message);
	}
}

export class SupabaseMilestoneRepository implements MilestoneRepository {
	async delete(milestoneId: number): Promise<void> {
		requireSaved(
			await supabase.from("milestones").delete().eq("id", milestoneId).select("id").single(),
			"目標を削除できませんでした。",
		);
	}

	async updateText(
		milestoneId: number,
		challengeGoal: string,
		periodGoals: readonly PeriodGoal[],
		achievement: string,
	): Promise<void> {
		requireSaved(
			await supabase
				.from("milestones")
				.update({ challenge_goal: challengeGoal, period_goals: periodGoals, achievement })
				.eq("id", milestoneId)
				.select("id")
				.single(),
			"Failed to update milestone text.",
		);
	}

	async upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		periodGoals: readonly PeriodGoal[],
		achievement: string,
	): Promise<void> {
		// (sheet_id, goal_number) の一意制約で、あれば更新・なければ追加する
		requireSaved(
			await supabase
				.from("milestones")
				.upsert(
					{
						sheet_id: sheetId,
						goal_number: goalNumber,
						challenge_goal: challengeGoal,
						period_goals: periodGoals,
						achievement,
					},
					{ onConflict: "sheet_id,goal_number" },
				)
				.select("id")
				.single(),
			"Failed to upsert milestone text.",
		);
	}

	async updateScore(milestoneId: number, firstScore?: number, secondScore?: number): Promise<void> {
		const payload: Record<string, unknown> = {};
		if (firstScore !== undefined) {
			payload.first_score = firstScore;
		}
		if (secondScore !== undefined) {
			payload.second_score = secondScore;
		}

		requireSaved(
			await supabase.from("milestones").update(payload).eq("id", milestoneId).select("id").single(),
			"Failed to update milestone score.",
		);
	}

	async findPreviousGoals(sheetId: number): Promise<PreviousGoals | null> {
		const { data, error } = await supabase.rpc("get_previous_goals", { p_sheet_id: sheetId });
		if (error) {
			throw new Error(error.message);
		}
		return (data as PreviousGoals | null) ?? null;
	}

	async carryOver(sheetId: number, previousGoalId: number): Promise<number> {
		// 本人の下書きか、前期の目標か、引き継ぎ済みでないか、上限を越えないかは DB 関数が確かめる
		const { data, error } = await supabase.rpc("carry_over_goal", {
			p_sheet_id: sheetId,
			p_goal_id: previousGoalId,
		});
		if (error) {
			throw new Error(error.message);
		}
		if (typeof data !== "number") {
			throw new Error("引き継いだ目標の番号を読めませんでした。");
		}
		return data;
	}
}
