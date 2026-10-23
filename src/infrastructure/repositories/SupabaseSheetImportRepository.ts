import type {
	CommonImportRow,
	GoalImportRow,
	SheetImportRepository,
	SheetImportResult,
	SheetImportTemplate,
} from "../../domain/repositories/SheetImportRepository";
import { supabase } from "../db/supabase";

export class SupabaseSheetImportRepository implements SheetImportRepository {
	async findTemplate(): Promise<SheetImportTemplate> {
		const { data, error } = await supabase.rpc("get_sheet_import_template");
		if (error) {
			throw new Error(error.message);
		}
		return data as SheetImportTemplate;
	}

	async importRows(
		goals: GoalImportRow[],
		common: CommonImportRow[],
		apply: boolean,
	): Promise<SheetImportResult> {
		// 全員分を1往復で送る。確かめるのも書くのも DB 関数の1トランザクション
		const { data, error } = await supabase.rpc("import_sheet_data", {
			p_goals: goals,
			p_common: common,
			p_apply: apply,
		});
		if (error) {
			throw new Error(error.message);
		}
		return data as SheetImportResult;
	}
}
