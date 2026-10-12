import type {
	CommonEvaluationRepository,
	CommonEvaluationResultPayload,
} from "../../domain/repositories/CommonEvaluationRepository";
import { supabase } from "../db/supabase";

export class SupabaseCommonEvaluationRepository implements CommonEvaluationRepository {
	/** 全項目を1回の問い合わせで保存する。自分の段階ではない列は送らず、DB も書き換えない。 */
	async upsertResults(
		sheetId: number,
		results: CommonEvaluationResultPayload[],
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<void> {
		if (results.length === 0 || !(canEditFirst || canEditSecond)) {
			return;
		}

		const { error } = await supabase.rpc("save_common_evaluation", {
			p_sheet_id: sheetId,
			p_results: results.map((result) => ({
				itemId: result.itemId,
				...(canEditFirst
					? { firstScore: result.firstScore, firstComment: result.firstComment }
					: {}),
				...(canEditSecond ? { secondScore: result.secondScore } : {}),
			})),
		});

		if (error) {
			throw error;
		}
	}
}
