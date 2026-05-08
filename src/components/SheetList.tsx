import { A } from "@solidjs/router";
import { ArrowDownAZ, ArrowUpAZ, Pencil, Plus } from "lucide-solid";
import { type Component, createResource, createSignal, For, Show } from "solid-js";
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
		start_date: string;
		end_date: string;
	} | null;
	employee: {
		name: string;
		employee_no: string;
	} | null;
}

export interface CategorizedSheets {
	mySheets: EvaluationSheetSummary[];
	subordinateSheets: EvaluationSheetSummary[];
}

export async function fetchCategorizedEvaluationSheets(): Promise<CategorizedSheets> {
	// 現在のログインユーザーに紐づく従業員情報を取得
	const { data: currentEmployees, error: employeeError } = await supabase
		.from("employees")
		.select("id");

	if (employeeError) {
		throw employeeError;
	}

	const currentEmployeeId = currentEmployees?.[0]?.id;

	if (!currentEmployeeId) {
		return { mySheets: [], subordinateSheets: [] };
	}

	// 1. 自分のシートを取得（employee_id が自分のID）
	const { data: myData, error: myError } = await supabase
		.from("evaluation_sheets")
		.select(`
			id,
			period_id,
			employee_id,
			status,
			total_score,
			created_at,
			updated_at,
			period:evaluation_periods!inner(period_name, start_date, end_date),
			employee:employees!inner(name, employee_no)
		`)
		.eq("employee_id", currentEmployeeId);

	if (myError) {
		throw myError;
	}

	// 2. 自分が評価者として設定されている従業員のIDを取得（自分自身は除外）
	const { data: subordinateEmployees, error: subordinatesError } = await supabase
		.from("employees")
		.select("id, name, employee_no")
		.or(`primary_evaluator_id.eq.${currentEmployeeId},secondary_evaluator_id.eq.${currentEmployeeId}`)
		.neq("id", currentEmployeeId); // 自分自身は除外

	if (subordinatesError) {
		throw subordinatesError;
	}

	const subordinateIds = subordinateEmployees?.map((emp) => emp.id) || [];

	// 3. 部下のシートを取得
	let subordinateData: Array<{
		id: number;
		period_id: number;
		employee_id: number;
		status: string;
		total_score: number;
		created_at: string;
		updated_at: string;
		period: unknown;
		employee: unknown;
	}> = [];
	if (subordinateIds.length > 0) {
		const { data, error: subordinateError } = await supabase
			.from("evaluation_sheets")
			.select(`
				id,
				period_id,
				employee_id,
				status,
				total_score,
				created_at,
				updated_at,
				period:evaluation_periods!inner(period_name, start_date, end_date),
				employee:employees!inner(name, employee_no)
			`)
			.in("employee_id", subordinateIds);

		if (subordinateError) {
			throw subordinateError;
		}

		subordinateData = data || [];
	}

	// データを正規化
	const mySheets = (myData || []).map((item) => ({
		...item,
		period: Array.isArray(item.period) ? item.period[0] : item.period,
		employee: Array.isArray(item.employee) ? item.employee[0] : item.employee,
	})) as EvaluationSheetSummary[];

	const subordinateSheets = subordinateData.map((item) => ({
		...item,
		period: Array.isArray(item.period) ? item.period[0] : item.period,
		employee: Array.isArray(item.employee) ? item.employee[0] : item.employee,
	})) as EvaluationSheetSummary[];

	return { mySheets, subordinateSheets };
}

type SortField = "period" | "status" | "name" | "updated";
type SortOrder = "asc" | "desc";

const SheetList: Component = () => {
	const [categorizedSheets] = createResource(fetchCategorizedEvaluationSheets);
	const [_periods] = createResource(fetchDistinctEvaluationPeriods);

	// ソート状態
	const [mySortField, setMySortField] = createSignal<SortField>("updated");
	const [mySortOrder, setMySortOrder] = createSignal<SortOrder>("desc");
	const [subordinateSortField, setSubordinateSortField] = createSignal<SortField>("updated");
	const [subordinateSortOrder, setSubordinateSortOrder] = createSignal<SortOrder>("desc");

	// ソート関数
	const sortSheets = (
		sheets: EvaluationSheetSummary[],
		field: SortField,
		order: SortOrder,
	): EvaluationSheetSummary[] => {
		const sorted = [...sheets].sort((a, b) => {
			let compareA: string | number;
			let compareB: string | number;

			switch (field) {
				case "period":
					compareA = a.period?.start_date || "";
					compareB = b.period?.start_date || "";
					break;
				case "status":
					compareA = a.status;
					compareB = b.status;
					break;
				case "name":
					compareA = a.employee?.name || "";
					compareB = b.employee?.name || "";
					break;
				case "updated":
					compareA = a.updated_at;
					compareB = b.updated_at;
					break;
				default:
					return 0;
			}

			if (compareA < compareB) return order === "asc" ? -1 : 1;
			if (compareA > compareB) return order === "asc" ? 1 : -1;
			return 0;
		});

		return sorted;
	};

	// ソートトグル関数
	const toggleSort = (
		currentField: SortField,
		setField: (field: SortField) => void,
		currentOrder: SortOrder,
		setOrder: (order: SortOrder) => void,
		newField: SortField,
	) => {
		if (currentField === newField) {
			setOrder(currentOrder === "asc" ? "desc" : "asc");
		} else {
			setField(newField);
			setOrder("asc");
		}
	};

	// ソートされたシートを取得
	const sortedMySheets = () => {
		const sheets = categorizedSheets()?.mySheets || [];
		return sortSheets(sheets, mySortField(), mySortOrder());
	};

	const sortedSubordinateSheets = () => {
		const sheets = categorizedSheets()?.subordinateSheets || [];
		return sortSheets(sheets, subordinateSortField(), subordinateSortOrder());
	};

	// ソートボタンコンポーネント
	const SortButton: Component<{
		field: SortField;
		currentField: SortField;
		currentOrder: SortOrder;
		onClick: () => void;
		label: string;
	}> = (props) => {
		const isActive = () => props.currentField === props.field;
		return (
			<button
				type="button"
				class={`sort-button ${isActive() ? "active" : ""}`}
				onClick={props.onClick}
			>
				{props.label}
				<Show when={isActive()}>
					{props.currentOrder === "asc" ? <ArrowUpAZ size={16} /> : <ArrowDownAZ size={16} />}
				</Show>
			</button>
		);
	};

	return (
		<div class="sheet-list-page">
			<header class="sheet-list-header">
				<h1>評価シート一覧</h1>
				<A href="/sheet/new" class="create-sheet-button">
					<Plus size={20} />
					<span>新規作成</span>
				</A>
			</header>

			<Show when={!categorizedSheets.loading} fallback={<p>シート情報を読み込み中です...</p>}>
				{/* 自分のシート */}
				<section class="sheet-section">
					<div class="sheet-section-header">
						<h2>自分の評価シート</h2>
						<div class="sort-controls">
							<span class="sort-label">並び替え:</span>
							<SortButton
								field="period"
								currentField={mySortField()}
								currentOrder={mySortOrder()}
								onClick={() =>
									toggleSort(mySortField(), setMySortField, mySortOrder(), setMySortOrder, "period")
								}
								label="期間"
							/>
							<SortButton
								field="status"
								currentField={mySortField()}
								currentOrder={mySortOrder()}
								onClick={() =>
									toggleSort(mySortField(), setMySortField, mySortOrder(), setMySortOrder, "status")
								}
								label="ステータス"
							/>
							<SortButton
								field="updated"
								currentField={mySortField()}
								currentOrder={mySortOrder()}
								onClick={() =>
									toggleSort(
										mySortField(),
										setMySortField,
										mySortOrder(),
										setMySortOrder,
										"updated",
									)
								}
								label="更新日"
							/>
						</div>
					</div>
					<Show
						when={sortedMySheets().length > 0}
						fallback={<p class="empty-message">自分の評価シートがありません。</p>}
					>
						<div class="sheet-list-grid">
							<For each={sortedMySheets()}>
								{(sheet) => (
									<article class="sheet-list-item">
										<div class="sheet-list-item__header">
											<h3>
												{sheet.employee?.name || "不明"} ({sheet.employee?.employee_no || "-"})
											</h3>
											<span class={`sheet-status sheet-status--${sheet.status}`}>
												{sheet.status}
											</span>
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
				</section>

				{/* 評価対象者のシート */}
				<Show when={sortedSubordinateSheets().length > 0}>
					<section class="sheet-section">
						<div class="sheet-section-header">
							<h2>評価対象者のシート</h2>
							<div class="sort-controls">
								<span class="sort-label">並び替え:</span>
								<SortButton
									field="period"
									currentField={subordinateSortField()}
									currentOrder={subordinateSortOrder()}
									onClick={() =>
										toggleSort(
											subordinateSortField(),
											setSubordinateSortField,
											subordinateSortOrder(),
											setSubordinateSortOrder,
											"period",
										)
									}
									label="期間"
								/>
								<SortButton
									field="status"
									currentField={subordinateSortField()}
									currentOrder={subordinateSortOrder()}
									onClick={() =>
										toggleSort(
											subordinateSortField(),
											setSubordinateSortField,
											subordinateSortOrder(),
											setSubordinateSortOrder,
											"status",
										)
									}
									label="ステータス"
								/>
								<SortButton
									field="name"
									currentField={subordinateSortField()}
									currentOrder={subordinateSortOrder()}
									onClick={() =>
										toggleSort(
											subordinateSortField(),
											setSubordinateSortField,
											subordinateSortOrder(),
											setSubordinateSortOrder,
											"name",
										)
									}
									label="氏名"
								/>
								<SortButton
									field="updated"
									currentField={subordinateSortField()}
									currentOrder={subordinateSortOrder()}
									onClick={() =>
										toggleSort(
											subordinateSortField(),
											setSubordinateSortField,
											subordinateSortOrder(),
											setSubordinateSortOrder,
											"updated",
										)
									}
									label="更新日"
								/>
							</div>
						</div>
						<div class="sheet-list-grid">
							<For each={sortedSubordinateSheets()}>
								{(sheet) => (
									<article class="sheet-list-item">
										<div class="sheet-list-item__header">
											<h3>
												{sheet.employee?.name || "不明"} ({sheet.employee?.employee_no || "-"})
											</h3>
											<span class={`sheet-status sheet-status--${sheet.status}`}>
												{sheet.status}
											</span>
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
					</section>
				</Show>
			</Show>
		</div>
	);
};

export default SheetList;
