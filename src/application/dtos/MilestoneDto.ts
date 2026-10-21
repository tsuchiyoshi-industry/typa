export interface MilestoneDto {
	id: number;
	sheetId: number;
	goalNumber: number;
	challengeGoal: string;
	midtermGoal: string;
	achievement: string;
	/** 本人からは評価が確定するまで伏せられるため null になり得る。 */
	firstScore: number | null;
	/** 一次評価者と、確定前の本人からは伏せられるため null になり得る。 */
	secondScore: number | null;
}
