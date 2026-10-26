import type { PrivilegedSheetOperation } from "../../domain/entities/PrivilegedSheetOperation";
import type { PrivilegedSheetRepository } from "../../domain/repositories/PrivilegedSheetRepository";
import { supabase } from "../db/supabase";

export class SupabasePrivilegedSheetRepository implements PrivilegedSheetRepository {
	async execute(operation: PrivilegedSheetOperation): Promise<void> {
		const { error } = await supabase.rpc("privileged_sheet_operation", {
			p_sheet_id: operation.sheetId,
			p_action: operation.action,
			p_status: operation.status,
			p_expected_status: operation.expectedStatus,
			p_reason: operation.reason,
		});
		if (error) {
			throw error;
		}
	}
}
