import type { PeriodGoal } from "../valueObjects/PeriodGoal";

/** 前の評価期間のシートの目標(文言だけ。点数は含まない)。 */
export interface PreviousGoals {
	periodName: string;
	goals: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		periodGoals: readonly PeriodGoal[];
		achievement: string;
		/** このシートへ引き継いだ先の目標番号。引き継いでいなければ null。 */
		carriedInto: number | null;
	}[];
}

/** 目標の書き込み。保存後の内容は、評価シートを読み直して得る(見せてよい範囲は DB が決める)。 */
export interface MilestoneRepository {
	delete(milestoneId: number): Promise<void>;
	updateText(
		milestoneId: number,
		challengeGoal: string,
		periodGoals: readonly PeriodGoal[],
		achievement: string,
	): Promise<void>;
	upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		periodGoals: readonly PeriodGoal[],
		achievement: string,
	): Promise<void>;
	updateScore(milestoneId: number, firstScore?: number, secondScore?: number): Promise<void>;
	/** 同じ社員の、前の評価期間(EvaluationCalendar.previousOf)のシートの目標。そのシートが無い、または見られないときは null。 */
	findPreviousGoals(sheetId: number): Promise<PreviousGoals | null>;
	/**
	 * 前期のチャレンジ目標を、このシート(本人の下書き)へ引き継ぐ。写すのはチャレンジ目標の文言だけで、
	 * 期中目標と達成状況は今期の分を書く。空の目標があればそこへ、無ければ空いている番号に入れる。
	 * 入れた先の目標番号を返す。
	 */
	carryOver(sheetId: number, previousGoalId: number): Promise<number>;
}
