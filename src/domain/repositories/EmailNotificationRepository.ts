export interface SheetFinalizedNotification {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
	totalScore: number;
}

export interface EmailNotificationRepository {
	notifySheetFinalized(notification: SheetFinalizedNotification): Promise<void>;
}
