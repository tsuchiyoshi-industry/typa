import { CommonEvaluationItem } from "../../domain/entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../../domain/entities/CommonEvaluationResult";
import type {
	CommonEvaluationDraft,
	CommonEvaluationRepository,
	CommonEvaluationResultPayload,
} from "../../domain/repositories/CommonEvaluationRepository";
import { supabase } from "../db/supabase";

interface CommonEvaluationItemRow {
	id: number;
	title: string;
	description: string;
	weight: number;
	grade_id: number | null;
}

interface CommonEvaluationResultRow {
	id: number;
	sheet_id: number;
	item_id: number;
	first_score: number | null;
	second_score: number | null;
	first_comment: string | null;
	item: CommonEvaluationItemRow;
}

export class SupabaseCommonEvaluationRepository implements CommonEvaluationRepository {
	async findItemsByGrade(gradeId: number | null): Promise<CommonEvaluationItem[]> {
		let query = supabase.from("common_evaluation_items").select("*");
		if (gradeId != null) {
			query = query.or(`grade_id.is.null,grade_id.eq.${gradeId}`);
		} else {
			query = query.is("grade_id", null);
		}

		const { data, error } = await query.order("id");
		if (error) {
			throw error;
		}

		return (data as CommonEvaluationItemRow[]).map(
			(item) =>
				new CommonEvaluationItem(item.id, item.title, item.description, item.weight, item.grade_id),
		);
	}

	async findResultsBySheetId(
		sheetId: number,
		gradeId: number | null,
	): Promise<{
		results: CommonEvaluationResult[];
		totalFirstScore: number;
		totalSecondScore: number;
		totalWeight: number;
		firstRate: number;
		secondRate: number;
	}> {
		const items = await this.findItemsByGrade(gradeId);

		const { data, error } = await supabase
			.from("common_evaluation_results")
			.select("*, item:common_evaluation_items(*)")
			.eq("sheet_id", sheetId)
			.order("item_id");

		if (error) {
			throw error;
		}

		const existingResults = (data as CommonEvaluationResultRow[]) ?? [];
		const resultsMap = new Map<number, CommonEvaluationResult>();
		for (const result of existingResults) {
			const item = result.item;
			resultsMap.set(
				result.item_id,
				CommonEvaluationResult.create({
					id: result.id,
					sheetId: result.sheet_id,
					itemId: result.item_id,
					firstScore: result.first_score ?? 0,
					secondScore: result.second_score ?? 0,
					firstComment: result.first_comment ?? undefined,
					item: new CommonEvaluationItem(
						item.id,
						item.title,
						item.description,
						item.weight,
						item.grade_id,
					),
				}),
			);
		}

		const results = items.map((item) => {
			const existing = resultsMap.get(item.id);
			if (existing) {
				return existing;
			}
			return CommonEvaluationResult.create({
				id: -item.id,
				sheetId,
				itemId: item.id,
				firstScore: 0,
				secondScore: 0,
				firstComment: "",
				item,
			});
		});

		const totalFirstScore = results.reduce((sum, r) => sum + r.firstScore.toNumber(), 0);
		const totalSecondScore = results.reduce((sum, r) => sum + r.secondScore.toNumber(), 0);
		const totalWeight = results.reduce((sum, r) => sum + r.item.weight, 0);
		const firstRate = totalWeight > 0 ? (totalFirstScore / totalWeight) * 100 : 0;
		const secondRate = totalWeight > 0 ? (totalSecondScore / totalWeight) * 100 : 0;

		return {
			results,
			totalFirstScore,
			totalSecondScore,
			totalWeight,
			firstRate,
			secondRate,
		};
	}

	async createResultsForSheet(sheetId: number, drafts: CommonEvaluationDraft[]): Promise<void> {
		const rows = drafts.map((draft) => ({
			sheet_id: sheetId,
			item_id: draft.itemId,
			first_score: draft.firstScore,
			second_score: draft.secondScore,
			first_comment: draft.firstComment,
		}));

		const { error } = await supabase
			.from("common_evaluation_results")
			.upsert(rows, { onConflict: "sheet_id,item_id" });

		if (error) {
			throw error;
		}
	}

	async upsertResults(
		sheetId: number,
		results: CommonEvaluationResultPayload[],
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<void> {
		const rows = results.map((result) => {
			const row: Record<string, unknown> = {
				sheet_id: sheetId,
				item_id: result.itemId,
			};
			if (canEditFirst) {
				row.first_score = result.firstScore;
				row.first_comment = result.firstComment;
			}
			if (canEditSecond) {
				row.second_score = result.secondScore;
			}
			return row;
		});

		const { error } = await supabase
			.from("common_evaluation_results")
			.upsert(rows, { onConflict: "sheet_id,item_id" });

		if (error) {
			throw error;
		}
	}
}
