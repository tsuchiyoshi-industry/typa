import { A, useNavigate } from "@solidjs/router";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ClipboardCheck from "lucide-solid/icons/clipboard-check";
import Download from "lucide-solid/icons/download";
import FilePlusCorner from "lucide-solid/icons/file-plus-corner";
import Plus from "lucide-solid/icons/plus";
import RotateCw from "lucide-solid/icons/rotate-cw";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	on,
	onMount,
	Show,
} from "solid-js";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { SheetListController } from "../controllers/SheetListController";
import type { SheetListViewModel } from "../presenters/SheetListPresenter";
import StatusChip from "./components/StatusChip";
import { showToast } from "./feedback";
import { formatDateTime, statusRank } from "./format";

type SortField = "name" | "status" | "updated";
type SortOrder = "asc" | "desc";

interface SheetListViewProps {
	controller: SheetListController;
	viewModel: () => SheetListViewModel;
}

const isFinalized = (sheet: SheetSummaryDto) => EvaluationStatus.from(sheet.status).isFinalized();

const sortValue = (sheet: SheetSummaryDto, field: SortField): string | number => {
	switch (field) {
		case "name":
			return sheet.employeeName;
		case "status":
			return statusRank(sheet.status);
		case "updated":
			return sheet.updatedAt;
	}
};

const SheetTable: Component<{
	title: string;
	sheets: SheetSummaryDto[];
	/** 自分のシートだけの表では氏名列は全行同じなので出さない。 */
	showName: boolean;
	exportingId?: number | null;
	onExport?: (sheet: SheetSummaryDto) => void;
	/** 見出しの右端に置く、この表に関係する画面への導線。 */
	action?: JSX.Element;
}> = (props) => {
	const navigate = useNavigate();
	const [sortField, setSortField] = createSignal<SortField>("updated");
	const [sortOrder, setSortOrder] = createSignal<SortOrder>("desc");

	const sorted = createMemo(() => {
		const direction = sortOrder() === "asc" ? 1 : -1;
		return [...props.sheets].sort((a, b) => {
			const valueA = sortValue(a, sortField());
			const valueB = sortValue(b, sortField());
			return valueA < valueB ? -direction : valueA > valueB ? direction : 0;
		});
	});

	const toggleSort = (field: SortField) => {
		if (sortField() === field) {
			setSortOrder(sortOrder() === "asc" ? "desc" : "asc");
		} else {
			setSortField(field);
			setSortOrder("asc");
		}
	};

	const SortHeader: Component<{ field: SortField; label: string }> = (headerProps) => {
		const isActive = () => sortField() === headerProps.field;
		return (
			<th aria-sort={isActive() ? (sortOrder() === "asc" ? "ascending" : "descending") : "none"}>
				<button
					type="button"
					class="sort-header"
					classList={{ active: isActive() }}
					onClick={() => toggleSort(headerProps.field)}
				>
					{headerProps.label}
					<Show when={isActive()}>
						{sortOrder() === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
					</Show>
				</button>
			</th>
		);
	};

	return (
		<section class="sheet-section">
			<div class="sheet-section-header">
				<h2>{props.title}</h2>
				<div class="sheet-section-header__side">
					<span class="sheet-count">{props.sheets.length} 件</span>
					{props.action}
				</div>
			</div>
			<div class="table-scroll">
				<table class="sheet-table">
					<thead>
						<tr>
							<Show when={props.showName}>
								<SortHeader field="name" label="氏名" />
							</Show>
							<th>作成時の等級</th>
							<SortHeader field="status" label="ステータス" />
							<SortHeader field="updated" label="最終更新" />
							<th>
								<span class="visually-hidden">操作</span>
							</th>
						</tr>
					</thead>
					<tbody>
						<For each={sorted()}>
							{(sheet) => {
								// 行全体がクリックできるが、キーボード操作の入口として先頭の列にリンクも置く
								const link = (label: string) => (
									<A
										href={`/sheet/${sheet.id}`}
										class="sheet-row__link"
										onClick={(event) => event.stopPropagation()}
									>
										{label}
									</A>
								);
								return (
									<tr class="sheet-row" onClick={() => navigate(`/sheet/${sheet.id}`)}>
										<Show when={props.showName}>
											<td>
												{link(sheet.employeeName)}
												<span class="sheet-row__sub">{sheet.employeeNo}</span>
											</td>
										</Show>
										<td>
											{props.showName
												? sheet.gradeName || "—"
												: link(sheet.gradeName || "等級未設定")}
										</td>
										<td>
											<StatusChip status={sheet.status} />
										</td>
										<td class="sheet-row__date">{formatDateTime(sheet.updatedAt)}</td>
										<td class="action-buttons">
											<Show when={props.onExport}>
												{/* 確定前は、押せないボタンではなく理由をそのまま書く(ツールチップには気づきにくい) */}
												<Show
													when={isFinalized(sheet)}
													fallback={<span class="export-hint">確定後に PDF 出力</span>}
												>
													<button
														type="button"
														class="export-button"
														onClick={(event) => {
															event.stopPropagation();
															props.onExport?.(sheet);
														}}
														disabled={props.exportingId != null}
													>
														<Download size={16} />
														<span>{props.exportingId === sheet.id ? "出力中..." : "PDF出力"}</span>
													</button>
												</Show>
											</Show>
											<ChevronRight class="sheet-row__chevron" size={18} />
										</td>
									</tr>
								);
							}}
						</For>
					</tbody>
				</table>
			</div>
		</section>
	);
};

const SheetListView: Component<SheetListViewProps> = (props) => {
	const [exportingId, setExportingId] = createSignal<number | null>(null);

	onMount(() => {
		void props.controller.load();
	});

	// 出力の結果そのものが入れ替わったときだけ知らせる(無関係な変化で同じ通知を出し直さない)
	const exportStatus = createMemo(() => props.viewModel().exportStatus);
	createEffect(
		on(
			exportStatus,
			(status) => {
				if (!status.message) {
					return;
				}
				if (status.success) {
					showToast("success", "PDFを保存しました", status.fileName ?? undefined);
				} else {
					showToast("error", "PDFを出力できませんでした", status.message);
				}
			},
			{ defer: true },
		),
	);

	// シートのある評価期間。新しい期間が先
	const periods = createMemo(() => {
		const byId = new Map<number, { id: number; name: string; startDate: string; count: number }>();
		for (const sheet of [...props.viewModel().mySheets, ...props.viewModel().subordinateSheets]) {
			const period = byId.get(sheet.periodId) ?? {
				id: sheet.periodId,
				name: sheet.periodName,
				startDate: sheet.startDate,
				count: 0,
			};
			period.count += 1;
			byId.set(sheet.periodId, period);
		}
		return [...byId.values()].sort((a, b) => b.startDate.localeCompare(a.startDate));
	});
	const [selectedPeriod, setSelectedPeriod] = createSignal<number | null>(null);
	/** 選んだ期間。選んでいない間と、選んだ期間のシートが無くなったときは、いちばん新しい期間。 */
	const periodId = createMemo(
		() => periods().find((period) => period.id === selectedPeriod())?.id ?? periods()[0]?.id,
	);
	const inPeriod = (sheets: SheetSummaryDto[]) =>
		sheets.filter((sheet) => sheet.periodId === periodId());
	const mySheets = createMemo(() => inPeriod(props.viewModel().mySheets));
	const subordinateSheets = createMemo(() => inPeriod(props.viewModel().subordinateSheets));

	const handleExport = async (sheet: SheetSummaryDto) => {
		setExportingId(sheet.id);
		try {
			await props.controller.exportSheet(sheet.id, sheet.employeeId, sheet.periodId);
		} finally {
			setExportingId(null);
		}
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
			{/* 自分のシートも部下のシートも、選んだ評価期間のものだけを下に出す。
			    下の表まで送っても切り替えられるよう、見出しの外に置いて画面の上に残す */}
			<Show when={periods().length > 0}>
				<nav class="period-tabs" aria-label="評価期間">
					<For each={periods()}>
						{(period) => (
							<button
								type="button"
								aria-pressed={period.id === periodId()}
								onClick={() => setSelectedPeriod(period.id)}
							>
								{period.name}
								<span>{period.count} 件</span>
							</button>
						)}
					</For>
				</nav>
			</Show>

			<Show when={props.viewModel().errorMessage}>
				<div class="inline-alert" role="alert">
					<span>{props.viewModel().errorMessage}</span>
					<button type="button" class="secondary-action" onClick={() => props.controller.load()}>
						<RotateCw class="action-icon" />
						再読み込み
					</button>
				</div>
			</Show>

			<Show
				when={!props.viewModel().loading}
				fallback={<p class="page-note">評価シートを読み込んでいます...</p>}
			>
				<Show
					when={mySheets().length > 0}
					fallback={
						<Show when={!props.viewModel().errorMessage}>
							<div class="empty-state">
								<FilePlusCorner class="empty-state__icon" />
								<h2>
									{props.viewModel().mySheets.length > 0
										? "この評価期間の自分の評価シートはありません"
										: "自分の評価シートはまだありません"}
								</h2>
								<Show when={props.viewModel().mySheets.length === 0}>
									<p>「新規作成」からシートを作成すると、ここに表示されます。</p>
								</Show>
							</div>
						</Show>
					}
				>
					<SheetTable
						title="自分の評価シート"
						sheets={mySheets()}
						showName={false}
						exportingId={exportingId()}
						onExport={(sheet) => void handleExport(sheet)}
					/>
				</Show>

				<Show when={subordinateSheets().length > 0}>
					<SheetTable
						title="部下の評価シート"
						sheets={subordinateSheets()}
						showName
						exportingId={exportingId()}
						onExport={(sheet) => void handleExport(sheet)}
						action={
							<A
								href="/review"
								class="section-nav-link"
								title="部下全員の進み具合を見て、自分の番から評価を進めます"
							>
								<ClipboardCheck size={16} />
								部下の評価へ
							</A>
						}
					/>
				</Show>
			</Show>
		</div>
	);
};

export default SheetListView;
