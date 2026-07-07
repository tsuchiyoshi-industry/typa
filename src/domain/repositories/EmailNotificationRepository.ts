export interface SheetFinalizedNotification {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
}

export interface EmailNotificationRepository {
	notifySheetFinalized(notification: SheetFinalizedNotification): Promise<void>;
}
