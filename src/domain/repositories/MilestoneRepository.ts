/** 前の評価期間のシートの目標(文言だけ。点数は含まない)。 */
export interface PreviousGoals {
	periodName: string;
	goals: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		/** このシートに引き継いだ。引き継いでいない目標は「済み」として扱う。 */
		carried: boolean;
	}[];
}

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
	/** 同じ社員の、前の評価期間(EvaluationCalendar.previousOf)のシートの目標。そのシートが無い、または見られないときは null。 */
	findPreviousGoals(sheetId: number): Promise<PreviousGoals | null>;
	/** 前の評価期間の目標を、このシート(本人の下書き)に引き継ぐ。チャレンジ目標の文言だけを写す。 */
	carryOver(sheetId: number, goalId: number): Promise<void>;
}
