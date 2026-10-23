import type {
	MilestoneRepository,
	PreviousGoals,
} from "../../domain/repositories/MilestoneRepository";
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
		midtermGoal: string,
		achievement: string,
	): Promise<void> {
		requireSaved(
			await supabase
				.from("milestones")
				.update({ challenge_goal: challengeGoal, midterm_goal: midtermGoal, achievement })
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
		midtermGoal: string,
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
						midterm_goal: midtermGoal,
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

	async carryOver(sheetId: number, goalId: number): Promise<void> {
		// 本人の下書きか、前の評価期間の目標か、上限を越えないかは DB 関数が確かめる
		const { error } = await supabase.rpc("carry_over_goal", {
			p_sheet_id: sheetId,
			p_goal_id: goalId,
		});
		if (error) {
			throw new Error(error.message);
		}
	}
}
