import { Milestone } from "../../domain/entities/Milestone";
import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import { supabase } from "../db/supabase";

interface MilestoneRow {
	id: number;
	sheet_id: number;
	goal_number: number;
	challenge_goal: string | null;
	midterm_goal: string | null;
	achievement: string | null;
	first_score: number | null;
	second_score: number | null;
}

export class SupabaseMilestoneRepository implements MilestoneRepository {
	private toEntity(item: MilestoneRow): Milestone {
		return Milestone.create({
			id: item.id,
			sheetId: item.sheet_id,
			goalNumber: item.goal_number,
			challengeGoal: item.challenge_goal ?? "",
			midtermGoal: item.midterm_goal ?? "",
			achievement: item.achievement ?? "",
			firstScore: item.first_score ?? 0,
			secondScore: item.second_score ?? 0,
		});
	}

	async delete(milestoneId: number): Promise<void> {
		const { data, error } = await supabase
			.from("milestones")
			.delete()
			.eq("id", milestoneId)
			.select("id")
			.single();
		if (error || !data) {
			throw error ?? new Error("目標を削除できませんでした。");
		}
	}

	async findBySheetId(sheetId: number): Promise<Milestone[]> {
		const { data, error } = await supabase
			.from("milestones")
			.select("*")
			.eq("sheet_id", sheetId)
			.order("goal_number", { ascending: true });

		if (error) {
			throw error;
		}

		return ((data as MilestoneRow[] | null) ?? []).map((item) => this.toEntity(item));
	}

	async updateText(
		milestoneId: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<Milestone> {
		const { data, error } = await supabase
			.from("milestones")
			.update({ challenge_goal: challengeGoal, midterm_goal: midtermGoal, achievement })
			.eq("id", milestoneId)
			.select("*")
			.single();

		if (error || !data) {
			throw error ?? new Error("Failed to update milestone text.");
		}

		return this.toEntity(data as MilestoneRow);
	}

	async upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<Milestone> {
		// (sheet_id, goal_number) の一意制約で、あれば更新・なければ追加する
		const { data, error } = await supabase
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
			.select("*")
			.single();

		if (error || !data) {
			throw error ?? new Error("Failed to upsert milestone text.");
		}

		return this.toEntity(data as MilestoneRow);
	}

	async updateScore(
		milestoneId: number,
		firstScore?: number,
		secondScore?: number,
	): Promise<Milestone> {
		const payload: Record<string, unknown> = {};
		if (firstScore !== undefined) {
			payload.first_score = firstScore;
		}
		if (secondScore !== undefined) {
			payload.second_score = secondScore;
		}

		const { data, error } = await supabase
			.from("milestones")
			.update(payload)
			.eq("id", milestoneId)
			.select("*")
			.single();

		if (error || !data) {
			throw error ?? new Error("Failed to update milestone score.");
		}

		return this.toEntity(data as MilestoneRow);
	}
}
