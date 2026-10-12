export interface CommonEvaluationResultPayload {
	id: number;
	itemId: number;
	firstComment: string;
	firstScore: number;
	secondScore: number;
}

export interface CommonEvaluationRepository {
	/**
	 * 共通評価をまとめて保存する。canEditFirst なら一次評価の点数とコメント、canEditSecond なら
	 * 二次評価の点数だけを送る。どちらを保存するかは、最終的に DB がシートの状態から決める。
	 */
	upsertResults(
		sheetId: number,
		results: CommonEvaluationResultPayload[],
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<void>;
}
