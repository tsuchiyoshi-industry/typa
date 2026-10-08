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
}

export type ReportDelivery = (delivery: NotificationDelivery) => void;

/** 送信の結果は、宛先ごとに結果が出るたび report で知らせる。宛先や SMTP 設定を読めないときは reject する。 */
export interface EmailNotificationRepository {
	/** 一次評価が確定し、二次評価を始められることを二次評価者へ知らせる。 */
	notifyFirstEvaluationConfirmed(
		notification: SheetNotification,
		report: ReportDelivery,
	): Promise<void>;
	notifySheetFinalized(notification: SheetNotification, report: ReportDelivery): Promise<void>;
}
