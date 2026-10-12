/** 目標の書き込み。保存後の内容は、評価シートを読み直して得る(見せてよい範囲は DB が決める)。 */
export interface MilestoneRepository {
	delete(milestoneId: number): Promise<void>;
	updateText(
		milestoneId: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<void>;
	upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<void>;
	updateScore(milestoneId: number, firstScore?: number, secondScore?: number): Promise<void>;
}
