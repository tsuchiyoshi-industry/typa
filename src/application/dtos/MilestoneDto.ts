export interface MilestoneDto {
	id: number;
	sheetId: number;
	goalNumber: number;
	challengeGoal: string;
	midtermGoal: string;
	achievement: string;
	firstScore: number;
	/** 一次評価者からは伏せられるため null になり得る。 */
	secondScore: number | null;
}
