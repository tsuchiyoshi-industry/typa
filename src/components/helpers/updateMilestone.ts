import { supabase } from "../../../utils/supabase";
import type { Milestone } from "./evaluationSheet";

export interface MilestoneUpdatePayload {
	challenge_goal: string;
	midterm_goal: string;
	achievement: string;
}

export interface MilestoneScorePayload {
	first_score?: number;
	second_score?: number;
}

export const updateMilestone = async (
	milestoneId: number,
	payload: MilestoneUpdatePayload,
): Promise<Milestone | null> => {
	const { data, error } = await supabase
		.from("milestones")
		.update(payload)
		.eq("id", milestoneId)
		.maybeSingle();

	if (error) {
		console.error("Error updating milestone:", error.message);
		throw error;
	}

	return data as Milestone | null;
};

export const updateMilestoneScore = async (
	milestoneId: number,
	payload: MilestoneScorePayload,
): Promise<Milestone | null> => {
	const { data, error } = await supabase
		.from("milestones")
		.update(payload)
		.eq("id", milestoneId)
		.maybeSingle();

	if (error) {
		console.error("Error updating milestone score:", error.message);
		throw error;
	}

	return data as Milestone | null;
};
