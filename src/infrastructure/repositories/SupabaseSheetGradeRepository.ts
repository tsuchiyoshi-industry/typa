import type { SheetGradeChange } from "../../domain/entities/SheetGradeChange";
import type { SheetGradeRepository } from "../../domain/repositories/SheetGradeRepository";
import { supabase } from "../db/supabase";

export class SupabaseSheetGradeRepository implements SheetGradeRepository {
	async execute(change: SheetGradeChange): Promise<number> {
		const { data, error } = await supabase.rpc("change_sheet_grade", {
			p_sheet_id: change.sheetId,
			p_grade_id: change.gradeId,
			p_expected_grade_id: change.expectedGradeId,
			p_expected_status: change.expectedStatus,
			p_reason: change.reason,
		});
		if (error) {
			throw error;
		}
		if (!Number.isInteger(data)) {
			throw new Error("等級を変更できたか確かめられませんでした。再読み込みしてください。");
		}
		return data as number;
	}
}
