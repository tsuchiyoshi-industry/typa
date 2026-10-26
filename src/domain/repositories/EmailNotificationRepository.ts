export interface SheetNotification {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
	primaryEvaluatorName: string;
	secondaryEvaluatorName: string;
}

/** 宛先ひとり分の送信結果。 */
export interface NotificationDelivery {
	/** 画面に出す宛先。例: 山田 太郎（二次評価者） */
	recipient: string;
	/** 送れなかった理由。送信できたときは無い。 */
	error?: string;
	alreadySent?: boolean;
}

export type ReportDelivery = (delivery: NotificationDelivery) => void;

/**
 * 送信はサーバー側で行う(宛先のメールアドレスと SMTP のパスワードはアプリに来ない)。
 * 送信の結果は宛先ごとに report で知らせる。送信を頼めなかったときは reject する。
 */
export interface EmailNotificationRepository {
	/**
	 * いまの状態でシートを受け取った人(EvaluationStatus.handoff の to)へ知らせる。
	 * 宛先のアドレスと文面は、サーバーが DB の状態から決める(画面から宛先は渡さない)。
	 */
	notifySheetStatusChanged(notification: SheetNotification, report: ReportDelivery): Promise<void>;
}
