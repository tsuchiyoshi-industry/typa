export const PERIOD_STATE_VALUES = ["not_started", "preparing", "active", "closed"] as const;
export type PeriodStateValue = (typeof PERIOD_STATE_VALUES)[number];

/**
 * 評価期間の状態。未開始 → 準備中 → 実施中 → 締め済み の順に進み、戻らない。
 * 実施中は常に1つ。締めた評価期間をもう一度開始することはできない。
 * 準備中は、実施中の評価期間が無い間の「次に開始する評価期間」。締めても次は自動では始まらず、
 * 管理者が等級の変更などを済ませてから開始する。保存はせず、暦(EvaluationCalendar)が決める。
 */
export class PeriodState {
	private constructor(
		private readonly value: PeriodStateValue,
		/** 画面に出す呼び方。 */
		readonly label: string,
	) {}

	static readonly NOT_STARTED = new PeriodState("not_started", "未開始");
	static readonly PREPARING = new PeriodState("preparing", "準備中");
	static readonly ACTIVE = new PeriodState("active", "実施中");
	static readonly CLOSED = new PeriodState("closed", "締め済み");

	/**
	 * 保存してある「実施中か」「締めたか」から。両方が立つことはない(立っていたらデータの不整合として例外)。
	 * 準備中は保存した値からは決まらない(EvaluationCalendar が決める)。
	 */
	static of(isActive: boolean, isClosed: boolean): PeriodState {
		if (isActive && isClosed) {
			throw new Error("実施中の評価期間は、締め済みにはなりません。");
		}
		return isActive ? PeriodState.ACTIVE : isClosed ? PeriodState.CLOSED : PeriodState.NOT_STARTED;
	}

	toString(): PeriodStateValue {
		return this.value;
	}
}
