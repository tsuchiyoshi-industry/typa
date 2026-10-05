export interface EvaluationNotificationRecipient {
	role: "primary" | "secondary";
	employeeId: number | null;
	/** Verified Supabase Auth email; null when unassigned or not registered/verified. */
	email: string | null;
}

export interface EvaluationNotificationRecipientRepository {
	findFinalizedSheetRecipients(sheetId: number): Promise<EvaluationNotificationRecipient[]>;
}
