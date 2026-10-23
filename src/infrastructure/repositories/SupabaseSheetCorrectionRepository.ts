import type { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { RetroactiveCorrection } from "../../domain/entities/RetroactiveCorrection";
import type { SheetCorrectionRepository } from "../../domain/repositories/SheetCorrectionRepository";
import { supabase } from "../db/supabase";
import { type SheetRpcRow, toSheet } from "./SupabaseEvaluationSheetRepository";

export class SupabaseSheetCorrectionRepository implements SheetCorrectionRepository {
	async findClosedSheet(sheetId: number): Promise<EvaluationSheet> {
		const { data, error } = await supabase.rpc("get_sheet_for_correction", { p_sheet_id: sheetId });
		if (error) {
			throw new Error(error.message);
		}
		const sheet = data ? toSheet(data as SheetRpcRow) : null;
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		return sheet;
	}

	async record(correction: RetroactiveCorrection): Promise<number> {
		// 確かめるのも書くのも、DB 関数の1トランザクション
		const { data, error } = await supabase.rpc("correct_closed_sheet", {
			p_sheet_id: correction.sheetId,
			p_changes: correction.changes.map((change) => ({
				target: change.field.target,
				targetId: change.targetId,
				field: change.field.value,
				value: change.after,
			})),
			p_reason: correction.reason.toString(),
		});
		if (error) {
			throw new Error(error.message);
		}
		return data as number;
	}
}
