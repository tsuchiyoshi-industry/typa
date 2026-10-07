export interface EvaluationNotificationRecipient {
	role: "primary" | "secondary";
	employeeId: number | null;
	/** Verified Supabase Auth email; null when unassigned or not registered/verified. */
	email: string | null;
}

export interface EvaluationNotificationRecipientRepository {
	/** 一次評価が確定したシートの二次評価者の宛先。未登録・未確認なら null。 */
	findFirstEvaluatedSheetRecipient(sheetId: number): Promise<string | null>;
	findFinalizedSheetRecipients(sheetId: number): Promise<EvaluationNotificationRecipient[]>;
}
