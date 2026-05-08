import { supabase } from "../../../utils/supabase";

export interface CommonEvaluationItem {
	id: number;
	title: string;
	description: string;
	weight: number;
}

export interface CommonEvaluationResult {
	id: number;
	sheet_id: number;
	item_id: number;
	first_score: number;
	second_score: number;
	first_comment: string;
	created_at: string;
	updated_at: string;
	item: CommonEvaluationItem;
}

export interface CommonEvaluationSummary {
	results: CommonEvaluationResult[];
	totalFirstScore: number;
	totalSecondScore: number;
	totalWeight: number;
	firstRate: number;
	secondRate: number;
}

export async function fetchCommonEvaluationItems(): Promise<CommonEvaluationItem[]> {
	const { data, error } = await supabase.from("common_evaluation_items").select("*").order("id");

	if (error) {
		throw error;
	}
	return data as CommonEvaluationItem[];
}

export async function fetchCommonEvaluation(sheetId: number): Promise<CommonEvaluationSummary> {
	// 全評価項目を取得
	const items = await fetchCommonEvaluationItems();

	// sheet_id で既存の評価結果を取得
	const { data: resultsData, error: resultsError } = await supabase
		.from("common_evaluation_results")
		.select(`
			*,
			item:common_evaluation_items(*)
		`)
		.eq("sheet_id", sheetId)
		.order("item_id");

	if (resultsError) {
		throw resultsError;
	}

	const existingResults = resultsData as CommonEvaluationResult[];

	// item_id をキーにした既存結果のマップ
	const resultsMap = new Map<number, CommonEvaluationResult>();
	for (const result of existingResults) {
		resultsMap.set(result.item_id, result);
	}

	// 未入力の項目はデフォルト値で補完
	const results: CommonEvaluationResult[] = items.map((item) => {
		const existing = resultsMap.get(item.id);
		if (existing) {
			return existing;
		}
		return {
			id: -item.id,
			sheet_id: sheetId,
			item_id: item.id,
			first_score: 0,
			second_score: 0,
			first_comment: "",
			created_at: "",
			updated_at: "",
			item,
		};
	});

	const totalFirstScore = results.reduce((sum, r) => sum + r.first_score, 0);
	const totalSecondScore = results.reduce((sum, r) => sum + r.second_score, 0);
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

export interface DraftRow {
	item: CommonEvaluationItem;
	first_comment: string;
	first_score: string;
	second_score: string;
}

/**
 * evaluation_sheets を upsert し、common_evaluation_results を一括 upsert する。
 * drafts が渡された場合はその入力値を使い、なければデフォルト値（0）で挿入する。
 * 作成/取得した sheet_id を返す。
 */
export async function createEvaluationSheet(
	periodId: number,
	employeeId: number,
	drafts?: DraftRow[],
): Promise<number> {
	// 1. evaluation_sheets を upsert（period_id + employee_id が衝突したら既存レコードを返す）
	const { data: sheetData, error: sheetError } = await supabase
		.from("evaluation_sheets")
		.upsert(
			{ period_id: periodId, employee_id: employeeId },
			{ onConflict: "period_id,employee_id", ignoreDuplicates: false },
		)
		.select("id")
		.single();

	if (sheetError) {
		throw sheetError;
	}

	const sheetId = (sheetData as { id: number }).id;

	// 2. common_evaluation_results を一括 upsert（sheet_id + item_id が衝突したら上書き）
	const items = drafts ? drafts.map((d) => d.item) : await fetchCommonEvaluationItems();

	const rows = items.map((item, i) => ({
		sheet_id: sheetId,
		item_id: item.id,
		first_score: drafts ? Number(drafts[i].first_score) || 0 : 0,
		second_score: drafts ? Number(drafts[i].second_score) || 0 : 0,
		first_comment: drafts ? drafts[i].first_comment : "",
	}));

	const { error: upsertError } = await supabase
		.from("common_evaluation_results")
		.upsert(rows, { onConflict: "sheet_id,item_id" });

	if (upsertError) {
		throw upsertError;
	}

	return sheetId;
}

/**
 * common_evaluation_result を更新する。
 * 一次評価者: first_score, first_comment を更新
 * 二次評価者: second_score を更新
 */
export async function updateCommonEvaluationResult(
	resultId: number,
	updates: {
		first_score?: number;
		second_score?: number;
		first_comment?: string;
	},
): Promise<void> {
	const { error } = await supabase
		.from("common_evaluation_results")
		.update(updates)
		.eq("id", resultId);

	if (error) {
		throw error;
	}
}

/**
 * 共通評価結果を一括でUPSERTする。
 * 既存レコード（id > 0）はUPDATE、未存在レコード（id < 0）はINSERTする。
 *
 * @param sheetId - 評価シートID
 * @param results - 更新する評価結果の配列
 * @param canEditFirst - 一次評価を編集可能か
 * @param canEditSecond - 二次評価を編集可能か
 */
export async function upsertCommonEvaluationResults(
	sheetId: number,
	results: Array<{
		id: number;
		item_id: number;
		first_comment: string;
		first_score: string;
		second_score: string;
	}>,
	canEditFirst: boolean,
	canEditSecond: boolean,
): Promise<void> {
	const rows = results.map((result) => {
		const row: {
			sheet_id: number;
			item_id: number;
			first_comment?: string;
			first_score?: number;
			second_score?: number;
		} = {
			sheet_id: sheetId,
			item_id: result.item_id,
		};

		if (canEditFirst) {
			row.first_comment = result.first_comment;
			row.first_score = Number(result.first_score) || 0;
		}

		if (canEditSecond) {
			row.second_score = Number(result.second_score) || 0;
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
