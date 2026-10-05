import type {
	EvaluationNotificationRecipient,
	EvaluationNotificationRecipientRepository,
} from "../../domain/repositories/EvaluationNotificationRecipientRepository";
import { supabase } from "../db/supabase";

export class SupabaseEvaluationNotificationRecipientRepository
	implements EvaluationNotificationRecipientRepository
{
	async findFinalizedSheetRecipients(sheetId: number): Promise<EvaluationNotificationRecipient[]> {
		const { data, error } = await supabase.rpc("get_finalized_sheet_notification_recipients", {
			p_sheet_id: sheetId,
		});
		if (error) {
			throw error;
		}
		if (
			!Array.isArray(data) ||
			data.length !== 2 ||
			new Set(data.map((row) => row?.role)).size !== 2 ||
			data.some(
				(row) =>
					!row ||
					(row.role !== "primary" && row.role !== "secondary") ||
					(row.employee_id !== null && !Number.isSafeInteger(row.employee_id)) ||
					(row.email !== null && typeof row.email !== "string"),
			)
		) {
			throw new Error("評価者の通知先情報が不正です。");
		}
		return data.map((row) => ({
			role: row.role,
			employeeId: row.employee_id,
			email: row.email,
		}));
	}
}
