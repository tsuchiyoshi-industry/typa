import { CommonEvaluationItem } from "../../domain/entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../../domain/entities/CommonEvaluationResult";
import type {
	CommonEvaluationDraft,
	CommonEvaluationRepository,
	CommonEvaluationResultPayload,
} from "../../domain/repositories/CommonEvaluationRepository";
import { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
import { supabase } from "../db/supabase";

interface CommonEvaluationItemRow {
	id: number;
	title: string;
	description: string;
	weight: number;
	item_set_id: number | null;
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

interface CommonEvaluationResultUpdate {
	first_score?: number;
	second_score?: number;
	first_comment?: string;
}

export class SupabaseCommonEvaluationRepository implements CommonEvaluationRepository {
	private async saveResult(
		sheetId: number,
		itemId: number,
		values: CommonEvaluationResultUpdate,
	): Promise<void> {
		if (Object.keys(values).length === 0) {
			return;
		}

		const { data: existingRows, error: findError } = await supabase
			.from("common_evaluation_results")
			.select("id")
			.eq("sheet_id", sheetId)
			.eq("item_id", itemId)
			.limit(1);

		if (findError) {
			throw findError;
		}

		const existing = (existingRows as Array<{ id: number }> | null)?.[0];
		if (existing) {
			const { error } = await supabase
				.from("common_evaluation_results")
				.update(values)
				.eq("id", existing.id);

			if (error) {
				throw error;
			}
			return;
		}

		const { error } = await supabase.from("common_evaluation_results").insert({
			sheet_id: sheetId,
			item_id: itemId,
			...values,
		});

		if (error) {
			throw error;
		}
	}

	/**
	 * 評価項目は等級ごとではなく項目セットごとに持つ。同じ項目で評価する等級(技術1級と一般1級など)は
	 * 同じセットを指す。セットのない等級・等級が未設定の社員は、全等級に共通の項目だけになる。
	 */
	private async findItemSetId(gradeId: number | null): Promise<number | null> {
		if (gradeId == null) {
			return null;
		}

		const { data, error } = await supabase
			.from("employee_grades")
			.select("item_set_id")
			.eq("id", gradeId)
			.maybeSingle();

		if (error) {
			throw error;
		}

		return (data as { item_set_id: number | null } | null)?.item_set_id ?? null;
	}

	async findItemsByGrade(gradeId: number | null): Promise<CommonEvaluationItem[]> {
		const itemSetId = await this.findItemSetId(gradeId);
		let query = supabase.from("common_evaluation_items").select("*");
		if (itemSetId != null) {
			query = query.or(`item_set_id.is.null,item_set_id.eq.${itemSetId}`);
		} else {
			query = query.is("item_set_id", null);
		}

		const { data, error } = await query.order("id");
		if (error) {
			throw error;
		}

		return (data as CommonEvaluationItemRow[]).map(
			(item) =>
				new CommonEvaluationItem(
					item.id,
					item.title,
					item.description,
					item.weight,
					item.item_set_id,
				),
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
						item.item_set_id,
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

		const totalWeight = results.reduce((sum, r) => sum + r.item.weight, 0);
		// 合計は「配点 × 評価」の合計。満点は totalWeight × 4
		const totals = EvaluationScoreTotals.fromCommonEvaluationResults(results);

		return {
			results,
			totalFirstScore: totals.firstTotalScore,
			totalSecondScore: totals.secondTotalScore,
			totalWeight,
			firstRate: totals.firstTotalRate,
			secondRate: totals.secondTotalRate,
		};
	}

	async createResultsForSheet(sheetId: number, drafts: CommonEvaluationDraft[]): Promise<void> {
		await Promise.all(
			drafts.map((draft) =>
				this.saveResult(sheetId, draft.itemId, {
					first_score: draft.firstScore,
					second_score: draft.secondScore,
					first_comment: draft.firstComment,
				}),
			),
		);
	}

	async upsertResults(
		sheetId: number,
		results: CommonEvaluationResultPayload[],
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<void> {
		await Promise.all(
			results.map((result) => {
				const values: CommonEvaluationResultUpdate = {};
				if (canEditFirst) {
					values.first_score = result.firstScore;
					values.first_comment = result.firstComment;
				}
				if (canEditSecond) {
					values.second_score = result.secondScore;
				}
				return this.saveResult(sheetId, result.itemId, values);
			}),
		);
	}
}
