import type { Milestone } from "../entities/Milestone";

export interface MilestoneRepository {
	delete(milestoneId: number): Promise<void>;
	findBySheetId(sheetId: number): Promise<Milestone[]>;
	updateText(
		milestoneId: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<Milestone>;
	upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<Milestone>;
	updateScore(milestoneId: number, firstScore?: number, secondScore?: number): Promise<Milestone>;
}
