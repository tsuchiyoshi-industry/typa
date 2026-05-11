import { A } from "@solidjs/router";
import { ArrowDownAZ, ArrowUpAZ, Plus } from "lucide-solid";
import { type Component, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { SheetListController } from "../controllers/SheetListController";
import type { SheetListViewModel } from "../presenters/SheetListPresenter";

type SortField = "period" | "status" | "name" | "updated";
type SortOrder = "asc" | "desc";

interface SheetListViewProps {
	controller: SheetListController;
	viewModel: () => SheetListViewModel;
}

const SheetListView: Component<SheetListViewProps> = (props) => {
	const [mySortField, setMySortField] = createSignal<SortField>("updated");
	const [mySortOrder, setMySortOrder] = createSignal<SortOrder>("desc");
	const [subordinateSortField, setSubordinateSortField] = createSignal<SortField>("updated");
	const [subordinateSortOrder, setSubordinateSortOrder] = createSignal<SortOrder>("desc");

	createEffect(() => {
		props.controller.load();
	});

	const sortSheets = (
		sheets: SheetListViewModel["mySheets"],
		field: SortField,
		order: SortOrder,
	) => {
		return [...sheets].sort((a, b) => {
			let compareA: string | number = "";
			let compareB: string | number = "";

			switch (field) {
				case "period":
					compareA = a.startDate;
					compareB = b.startDate;
					break;
				case "status":
					compareA = a.status;
					compareB = b.status;
					break;
				case "name":
					compareA = a.employeeName;
					compareB = b.employeeName;
					break;
				case "updated":
					compareA = a.updatedAt;
					compareB = b.updatedAt;
					break;
			}

			if (compareA < compareB) {
				return order === "asc" ? -1 : 1;
			}
			if (compareA > compareB) {
				return order === "asc" ? 1 : -1;
			}
			return 0;
		});
	};

	const sortedMySheets = createMemo(() =>
		sortSheets(props.viewModel().mySheets, mySortField(), mySortOrder()),
	);

	const sortedSubordinateSheets = createMemo(() =>
		sortSheets(props.viewModel().subordinateSheets, subordinateSortField(), subordinateSortOrder()),
	);

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

			<Show when={!props.viewModel().loading} fallback={<p>シート情報を読み込み中です...</p>}>
				<Show
					when={props.viewModel().mySheets.length > 0}
					fallback={<p>自分の評価シートはありません。</p>}
				>
					<section class="sheet-section">
						<div class="sheet-section-header">
							<h2>自分の評価シート</h2>
							<div class="sort-controls">
								<span>並び替え:</span>
								<SortButton
									field="period"
									currentField={mySortField()}
									currentOrder={mySortOrder()}
									onClick={() =>
										toggleSort(
											mySortField(),
											setMySortField,
											mySortOrder(),
											setMySortOrder,
											"period",
										)
									}
									label="期間"
								/>
								<SortButton
									field="status"
									currentField={mySortField()}
									currentOrder={mySortOrder()}
									onClick={() =>
										toggleSort(
											mySortField(),
											setMySortField,
											mySortOrder(),
											setMySortOrder,
											"status",
										)
									}
									label="ステータス"
								/>
								<SortButton
									field="name"
									currentField={mySortField()}
									currentOrder={mySortOrder()}
									onClick={() =>
										toggleSort(mySortField(), setMySortField, mySortOrder(), setMySortOrder, "name")
									}
									label="氏名"
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
						<table class="sheet-table">
							<thead>
								<tr>
									<th>評価期間</th>
									<th>ステータス</th>
									<th>氏名</th>
									<th>最終更新</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								<For each={sortedMySheets()}>
									{(sheet) => (
										<tr>
											<td>{sheet.periodName}</td>
											<td>{sheet.status}</td>
											<td>{sheet.employeeName}</td>
											<td>{sheet.updatedAt}</td>
											<td>
												<A href={`/sheet/${sheet.id}`} class="detail-link">
													詳細
												</A>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</section>
				</Show>

				<Show when={props.viewModel().subordinateSheets.length > 0}>
					<section class="sheet-section">
						<div class="sheet-section-header">
							<h2>部下の評価シート</h2>
							<div class="sort-controls">
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
						<table class="sheet-table">
							<thead>
								<tr>
									<th>評価期間</th>
									<th>ステータス</th>
									<th>氏名</th>
									<th>最終更新</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								<For each={sortedSubordinateSheets()}>
									{(sheet) => (
										<tr>
											<td>{sheet.periodName}</td>
											<td>{sheet.status}</td>
											<td>{sheet.employeeName}</td>
											<td>{sheet.updatedAt}</td>
											<td>
												<A href={`/sheet/${sheet.id}`} class="detail-link">
													詳細
												</A>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</section>
				</Show>
			</Show>
		</div>
	);
};

export default SheetListView;
