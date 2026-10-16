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
	/** シートが提出され、一次評価を始められることを一次評価者へ知らせる。 */
	notifySheetSubmitted(notification: SheetNotification, report: ReportDelivery): Promise<void>;
	/** 一次評価が確定し、二次評価を始められることを二次評価者へ知らせる。 */
	notifyFirstEvaluationConfirmed(
		notification: SheetNotification,
		report: ReportDelivery,
	): Promise<void>;
}
