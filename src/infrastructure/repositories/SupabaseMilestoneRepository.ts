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
	is_editable: boolean | null;
}

export class SupabaseMilestoneRepository implements MilestoneRepository {
	async findBySheetId(sheetId: number): Promise<Milestone[]> {
		const { data, error } = await supabase
			.from("milestones")
			.select("*")
			.eq("sheet_id", sheetId)
			.order("goal_number", { ascending: true });

		if (error || !data) {
			return [];
		}

		return (data as MilestoneRow[]).map((item) =>
			Milestone.create({
				id: item.id,
				sheetId: item.sheet_id,
				goalNumber: item.goal_number,
				challengeGoal: item.challenge_goal ?? "",
				midtermGoal: item.midterm_goal ?? "",
				achievement: item.achievement ?? "",
				firstScore: item.first_score ?? 0,
				secondScore: item.second_score ?? 0,
				isEditable: item.is_editable ?? false,
			}),
		);
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
			.maybeSingle();

		if (error || !data) {
			throw error ?? new Error("Failed to update milestone text.");
		}

		const item = data as MilestoneRow;
		return Milestone.create({
			id: item.id,
			sheetId: item.sheet_id,
			goalNumber: item.goal_number,
			challengeGoal: item.challenge_goal ?? "",
			midtermGoal: item.midterm_goal ?? "",
			achievement: item.achievement ?? "",
			firstScore: item.first_score ?? 0,
			secondScore: item.second_score ?? 0,
			isEditable: item.is_editable ?? false,
		});
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
			.maybeSingle();

		if (error || !data) {
			throw error ?? new Error("Failed to update milestone score.");
		}

		const item = data as MilestoneRow;
		return Milestone.create({
			id: item.id,
			sheetId: item.sheet_id,
			goalNumber: item.goal_number,
			challengeGoal: item.challenge_goal ?? "",
			midtermGoal: item.midterm_goal ?? "",
			achievement: item.achievement ?? "",
			firstScore: item.first_score ?? 0,
			secondScore: item.second_score ?? 0,
			isEditable: item.is_editable ?? false,
		});
	}
}
