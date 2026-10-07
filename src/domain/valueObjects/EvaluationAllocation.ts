/**
 * 評価点の配点。チャレンジ目標と共通評価に、合計 100 点をどう割り振るか。
 * Admin が「設定」で決める。評価点は「得点率 × 配点」で、評価ランクは評価点の得点率で決まる。
 */
export class EvaluationAllocation {
	static readonly TOTAL = 100;
	/** 設定をまだ保存していないときの配点。 */
	static readonly DEFAULT = new EvaluationAllocation(20, 80);

	private constructor(
		/** チャレンジ目標の配点。 */
		public readonly objective: number,
		/** 共通評価の配点。 */
		public readonly common: number,
	) {}

	static of(objective: number, common: number): EvaluationAllocation {
		if (
			!Number.isInteger(objective) ||
			!Number.isInteger(common) ||
			objective < 0 ||
			common < 0 ||
			objective + common !== EvaluationAllocation.TOTAL
		) {
			throw new Error(
				`配点は 0 以上の整数で、チャレンジ目標と共通評価の合計を ${EvaluationAllocation.TOTAL} にしてください。`,
			);
		}
		return new EvaluationAllocation(objective, common);
	}

	/** 得点率(%)を、その配点での評価点にする。 */
	static toScore(allocation: number, rate: number): number {
		return Math.round((allocation * rate) / 100);
	}

	/**
	 * 得点率を途中で丸めず、配点を掛けた後に1点単位に丸める。
	 * 先に割ると 7/10 × 45 が 31.499999… になり、31.5 点なのに切り捨てられる。整数どうしを先に掛ける。
	 */
	static fromTotal(allocation: number, score: number, maximum: number): number {
		return maximum > 0 ? Math.round((score * allocation) / maximum) : 0;
	}

	equals(other: EvaluationAllocation): boolean {
		return this.objective === other.objective && this.common === other.common;
	}
}
