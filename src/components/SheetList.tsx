import { A } from "@solidjs/router";
import { Pencil, Plus } from "lucide-solid";
import { type Component, createResource, For, Show } from "solid-js";
import { supabase } from "../../utils/supabase";
import { fetchDistinctEvaluationPeriods } from "./helpers/evaluationPeriods";

export interface EvaluationSheetSummary {
	id: number;
	period_id: number;
	employee_id: number;
	status: string;
	total_score: number;
	created_at: string;
	updated_at: string;
	period: {
		period_name: string;
	} | null;
	employee: {
		name: string;
		employee_no: string;
	} | null;
}

export async function fetchEvaluationSheets(): Promise<EvaluationSheetSummary[]> {
	const { data, error } = await supabase
		.from("evaluation_sheets")
		.select(`
			id,
			period_id,
			employee_id,
			status,
			total_score,
			created_at,
			updated_at,
			period:evaluation_periods!inner(period_name),
			employee:employees!inner(name, employee_no)
		`)
		.order("updated_at", { ascending: false });

	if (error) {
		throw error;
	}

	// Supabaseは関連データを配列で返すことがあるので、最初の要素を取得
	return (data || []).map((item: any) => ({
		...item,
		period: Array.isArray(item.period) ? item.period[0] : item.period,
		employee: Array.isArray(item.employee) ? item.employee[0] : item.employee,
	})) as EvaluationSheetSummary[];
}

const SheetList: Component = () => {
	const [sheets] = createResource(fetchEvaluationSheets);
	const [_periods] = createResource(fetchDistinctEvaluationPeriods);

	return (
		<div class="sheet-list-page">
			<header class="sheet-list-header">
				<h1>評価シート一覧</h1>
				<A href="/sheet/new" class="create-sheet-button">
					<Plus size={20} />
					<span>新規作成</span>
				</A>
			</header>

			<Show when={!sheets.loading} fallback={<p>シート情報を読み込み中です...</p>}>
				<Show
					when={sheets()?.length}
					fallback={<p>評価シートがありません。新規作成してください。</p>}
				>
					<div class="sheet-list-grid">
						<For each={sheets()}>
							{(sheet) => (
								<article class="sheet-list-item">
									<div class="sheet-list-item__header">
										<h3>
											{sheet.employee?.name || "不明"} ({sheet.employee?.employee_no || "-"})
										</h3>
										<span class="sheet-status">{sheet.status}</span>
									</div>
									<div class="sheet-list-item__meta">
										<span>期間: {sheet.period?.period_name || "未設定"}</span>
										<span>合計点: {sheet.total_score}</span>
										<span>更新日: {new Date(sheet.updated_at).toLocaleDateString()}</span>
									</div>
									<div class="sheet-list-item__actions">
										<A href={`/sheet/${sheet.id}`} class="edit-sheet-button">
											<Pencil size={16} />
											<span>編集</span>
										</A>
									</div>
								</article>
							)}
						</For>
					</div>
				</Show>
			</Show>
		</div>
	);
};

export default SheetList;
