export interface SheetNotification {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
}

export interface EmailNotificationRepository {
	/** 一次評価が確定し、二次評価を始められることを二次評価者へ知らせる。 */
	notifyFirstEvaluationConfirmed(notification: SheetNotification): Promise<void>;
	notifySheetFinalized(notification: SheetNotification): Promise<void>;
}
