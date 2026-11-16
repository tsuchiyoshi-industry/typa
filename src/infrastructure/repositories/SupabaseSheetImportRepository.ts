import type {
	SheetImportRepository,
	SheetImportRequest,
	SheetImportResult,
	SheetImportTemplate,
} from "../../domain/repositories/SheetImportRepository";
import { supabase } from "../db/supabase";

export class SupabaseSheetImportRepository implements SheetImportRepository {
	async findTemplate(periodId: number): Promise<SheetImportTemplate> {
		const { data, error } = await supabase.rpc("get_sheet_import_template", {
			p_period_id: periodId,
		});
		if (error) {
			throw new Error(error.message);
		}
		return data as SheetImportTemplate;
	}

	async importRows(request: SheetImportRequest): Promise<SheetImportResult> {
		// 全員分を1往復で送る。確かめるのも書くのも DB 関数の1トランザクション
		const { data, error } = await supabase.rpc("import_sheet_data", {
			p_period_id: request.periodId,
			p_goals: request.goals,
			p_common: request.common,
			p_apply: request.apply,
			p_closed_confirmed: request.closedPeriodConfirmed,
		});
		if (error) {
			throw new Error(error.message);
		}
		return data as SheetImportResult;
	}
}
