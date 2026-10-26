export type InAppNotificationKind =
	| "goals_submitted"
	| "goals_confirmed"
	| "goals_returned"
	| "submitted"
	| "first_evaluated";

/** アプリ内通知 1 件。評価の依頼で、状態の変更と同時に DB が作る。 */
export interface InAppNotification {
	id: number;
	sheetId: number;
	/**
	 * goals_submitted: 目標の確認の依頼(一次評価者へ) / goals_confirmed: 目標の確定(本人へ) /
	 * goals_returned: 目標の要修正(本人へ) / submitted: 一次評価の依頼 / first_evaluated: 二次評価の依頼
	 */
	kind: InAppNotificationKind;
	/** 知らせた時点の、評価される人と評価期間の名前 */
	employeeName: string;
	periodName: string;
	/** ISO 8601 */
	createdAt: string;
	read: boolean;
}

/** 自分あてのアプリ内通知。ほかの人あての通知は DB が見せない。 */
export interface NotificationInboxRepository {
	/** 新しい順。 */
	findMine(): Promise<InAppNotification[]>;
	markRead(ids: readonly number[]): Promise<void>;
	markAllRead(): Promise<void>;
}
