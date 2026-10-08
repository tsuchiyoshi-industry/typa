import { useSearchParams } from "@solidjs/router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ClipboardCheck from "lucide-solid/icons/clipboard-check";
import Columns3 from "lucide-solid/icons/columns-3";
import ListFilter from "lucide-solid/icons/list-filter";
import RotateCw from "lucide-solid/icons/rotate-cw";
import Search from "lucide-solid/icons/search";
import Users from "lucide-solid/icons/users";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { ReviewerRowDto, ReviewPeriodDto } from "../../application/dtos/ReviewerWorkspaceDto";
import type { ReviewerWorkspaceController } from "../controllers/ReviewerWorkspaceController";
import {
	canOpen,
	filterReviewRows,
	finalScore,
	gradeKey,
	gradeOptions,
	groupByGrade,
	isMyTurn,
	nextMyTurn,
	primaryEvaluatorKey,
	primaryEvaluatorOptions,
	type ReviewFilter,
	type ReviewSort,
	reviewLabel,
	reviewRank,
	reviewScore,
	reviewStats,
	reviewTask,
	sheetStatus,
} from "../viewmodels/reviewerWorkspace";
import { clearUnsavedChanges, confirmDiscard, hasUnsavedChanges, showToast } from "./feedback";
import { formatDateTime } from "./format";
import SheetEditorView, { type SheetEditorViewProps } from "./SheetEditorView";

interface Props {
	controller: ReviewerWorkspaceController;
	editor: SheetEditorViewProps;
}

const scoreText = (value: number | null) => (value === null ? "—" : String(value));
const Badge: Component<{ row: ReviewerRowDto }> = (props) => (
	<span
		class="review-badge"
		classList={{
			action: isMyTurn(props.row),
			done: reviewTask(props.row) === "finalized",
			waiting: reviewTask(props.row) === "waiting",
		}}
	>
		{reviewLabel(props.row)}
	</span>
);
/** 評価点とランク。確定前のランクは見込みとして控えめに出す。 */
const ScoreRank: Component<{ row: ReviewerRowDto; stage: "first" | "final" }> = (props) => {
	const score = () =>
		props.stage === "first" ? reviewScore(props.row, "first") : finalScore(props.row);
	const rank = () => reviewRank(props.row, props.stage);
	return (
		<span class="review-score-rank">
			{scoreText(score())}
			<Show when={rank()}>
				{(value) => (
					<strong
						class="review-rank"
						classList={{ provisional: !value().confirmed }}
						title={value().confirmed ? "確定したランク" : "現在の点数からの見込み"}
					>
						{value().text}
					</strong>
				)}
			</Show>
		</span>
	);
};

const ReviewerWorkspaceView: Component<Props> = (props) => {
	const [params, setParams] = useSearchParams();
	const [periods, setPeriods] = createSignal<ReviewPeriodDto[]>([]);
	const [rows, setRows] = createSignal<ReviewerRowDto[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [refreshing, setRefreshing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [editorSaving, setEditorSaving] = createSignal(false);
	const [editorRefresh, setEditorRefresh] = createSignal(0);
	const [query, setQuery] = createSignal("");
	const [grade, setGrade] = createSignal("");
	const [primaryEvaluator, setPrimaryEvaluator] = createSignal("");
	const [filter, setFilter] = createSignal<ReviewFilter>("all");
	const [sort, setSort] = createSignal<ReviewSort>("priority");
	const [selected, setSelected] = createSignal<ReadonlySet<number>>(new Set());
	const [syncedAt, setSyncedAt] = createSignal<string | null>(null);
	let generation = 0;
	let alive = true;
	onCleanup(() => {
		alive = false;
		++generation;
	});
	const periodId = createMemo(
		() =>
			periods().find((period) => period.id === Number(params.period))?.id ||
			periods().find((p) => p.isActive)?.id ||
			periods()[0]?.id ||
			null,
	);
	const mode = createMemo(() =>
		params.mode === "compare" ? "compare" : params.mode === "evaluate" ? "evaluate" : "list",
	);
	const current = createMemo(() =>
		rows().find((row) => canOpen(row) && String(row.sheetId) === params.sheet),
	);
	const filterOptions = () => ({
		query: query(),
		grade: grade(),
		primaryEvaluator: primaryEvaluator(),
		filter: filter(),
		sort: sort(),
	});
	const visible = createMemo(() => filterReviewRows(rows(), filterOptions()));
	const grades = createMemo(() => gradeOptions(rows()));
	const primaryEvaluators = createMemo(() => primaryEvaluatorOptions(rows()));
	const primaryEvaluatorLabel = createMemo(() =>
		primaryEvaluators().find((label) => label.id === primaryEvaluator()),
	);
	const count = (task: ReviewFilter) => rows().filter((row) => reviewTask(row) === task).length;
	const stats = createMemo(() => reviewStats(rows()));
	const next = createMemo(() => nextMyTurn(visible(), current()?.employeeId));
	const detailedComparison = () => params.detail === "1" && selected().size > 0;
	const comparisonRows = createMemo(() =>
		detailedComparison() ? visible().filter((row) => selected().has(row.employeeId)) : visible(),
	);
	const groups = createMemo(() => groupByGrade(comparisonRows()));
	const mutationBusy = () => refreshing() || loading() || editorSaving();
	const currentSheetId = createMemo(() => current()?.sheetId);
	const editorIdentity = createMemo(() => ({
		sheetId: currentSheetId(),
		refresh: editorRefresh(),
	}));

	const load = async (id: number, initial = false): Promise<ReviewerRowDto[] | null> => {
		const request = ++generation;
		if (initial) {
			setLoading(true);
			setRows([]);
			setSelected(new Set<number>());
		}
		setRefreshing(true);
		setError(null);
		try {
			const loaded = await props.controller.load(id);
			if (!alive || request !== generation) {
				return null;
			}
			setRows(loaded);
			setPrimaryEvaluator((previous) =>
				loaded.some((row) => primaryEvaluatorKey(row) === previous) ? previous : "",
			);
			setGrade((previous) => (loaded.some((row) => gradeKey(row) === previous) ? previous : ""));
			setSyncedAt(new Date().toISOString());
			setSelected(
				(previous) =>
					new Set(
						[...previous].filter((employeeId) =>
							loaded.some((row) => row.employeeId === employeeId),
						),
					),
			);
			return loaded;
		} catch (reason) {
			if (alive && request === generation) {
				setError(
					reason instanceof Error
						? reason.message
						: ((reason as { message?: string })?.message ?? "部下の一覧を読み込めませんでした。"),
				);
			}
			return null;
		} finally {
			if (alive && request === generation) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	};
	const initializePeriods = async () => {
		setLoading(true);
		setError(null);
		try {
			const loaded = await props.controller.loadPeriods();
			if (alive) {
				setPeriods(loaded);
				if (!loaded.length) {
					setLoading(false);
				}
			}
		} catch {
			if (alive) {
				setError("評価期間を読み込めませんでした。再読み込みしてください。");
				setLoading(false);
			}
		}
	};
	onMount(() => void initializePeriods());
	createEffect(() => {
		const id = periodId();
		if (id) {
			void load(id, true);
		}
	});

	const navigate = async (values: Record<string, string | number | undefined>) => {
		if (editorSaving()) {
			showToast("info", "保存が完了するまでお待ちください");
			return;
		}
		if (!(await confirmDiscard())) {
			return;
		}
		clearUnsavedChanges();
		setParams(values, { scroll: false });
	};
	const open = (row: ReviewerRowDto) => {
		if (canOpen(row)) {
			void navigate({
				sheet: row.sheetId as number,
				mode: "evaluate",
				period: periodId() ?? undefined,
			});
		}
	};
	const updateRows = () => {
		const id = periodId();
		if (id) {
			void load(id);
		}
	};
	const refresh = async () => {
		if (hasUnsavedChanges()) {
			showToast("info", "入力中の内容があります", "保存してから再読み込みしてください。");
			return;
		}
		const id = periodId();
		if (!id) {
			await initializePeriods();
			return;
		}
		if (current()?.sheetId && mode() === "evaluate") {
			setEditorRefresh((value) => value + 1);
		}
		if (id) {
			await load(id);
		}
	};
	// 確定の確認で案内した「次の対象者」。確定で一覧の並びが変わっても、案内した人へ進む
	let announcedNext: number | undefined;
	const announceNext = () => {
		const target = next();
		announcedNext = target?.employeeId;
		return target?.employeeName;
	};
	/** 一次評価・評価を確定したら、一覧を取り直して次の「自分の番」へ進む。 */
	const advance = async () => {
		const id = periodId();
		const finished = current()?.employeeId;
		const loaded = id ? await load(id) : null;
		if (!alive || !loaded) {
			return;
		}
		const target =
			loaded.find((row) => row.employeeId === announcedNext && isMyTurn(row)) ??
			nextMyTurn(filterReviewRows(loaded, filterOptions()), finished);
		announcedNext = undefined;
		if (target?.sheetId) {
			setParams({ sheet: target.sheetId, mode: "evaluate" }, { scroll: false });
			showToast("info", `${target.employeeName} さんの評価に進みました`);
		} else {
			showToast("success", "この一覧で自分の番のシートはすべて確定しました");
		}
	};
	const toggleSelection = (row: ReviewerRowDto) => {
		setSelected((previous) => {
			const updated = new Set(previous);
			if (updated.has(row.employeeId)) {
				updated.delete(row.employeeId);
			} else if (updated.size < 6) {
				updated.add(row.employeeId);
			}
			return updated;
		});
	};
	const clearFilters = () => {
		setQuery("");
		setGrade("");
		setPrimaryEvaluator("");
		setFilter("all");
	};
	const selectionCount = () => visible().filter((row) => selected().has(row.employeeId)).length;
	const clearSelection = () => {
		setSelected(new Set<number>());
		setParams({ detail: undefined }, { replace: true, scroll: false });
	};

	const Filters = () => (
		<div class="review-filters">
			<label class="review-search">
				<Search size={16} />
				<span class="visually-hidden">部下を検索</span>
				<input
					type="search"
					placeholder="氏名・社員番号・一次評価者で検索"
					value={query()}
					onInput={(e) => setQuery(e.currentTarget.value)}
				/>
			</label>
			<label>
				<span class="visually-hidden">等級で絞り込み</span>
				<select value={grade()} onChange={(e) => setGrade(e.currentTarget.value)}>
					<option value="">すべての等級</option>
					<For each={grades()}>{([id, name]) => <option value={id}>{name}</option>}</For>
				</select>
			</label>
			{/* 一次評価者が自分だけなら、選ぶものがない */}
			<Show when={primaryEvaluators().length > 1}>
				<label>
					<span class="visually-hidden">一次評価者で絞り込み</span>
					<select
						value={primaryEvaluator()}
						onChange={(e) => setPrimaryEvaluator(e.currentTarget.value)}
					>
						<option value="">すべての一次評価者</option>
						<For each={primaryEvaluators()}>
							{(label) => (
								<option value={label.id}>
									{label.name} · {label.count}名
								</option>
							)}
						</For>
					</select>
				</label>
			</Show>
			<label>
				<span class="visually-hidden">表示順</span>
				<select value={sort()} onChange={(e) => setSort(e.currentTarget.value as ReviewSort)}>
					<option value="priority">自分の番が先</option>
					<option value="name">氏名順</option>
					<option value="firstScore">一次評価点順</option>
					<option value="finalScore">最終評価点順</option>
					<option value="gap">一次・二次の差が大きい順</option>
				</select>
			</label>
		</div>
	);
	const Empty = () => (
		<div class="review-empty">
			<ListFilter size={28} />
			<h2>{rows().length ? "条件に合う対象者がいません" : "この期間に評価する部下はいません"}</h2>
			<p>
				{rows().length
					? "検索や絞り込み条件を変えてください。"
					: "一次・二次評価の担当者がここに表示されます。"}
			</p>
			<Show when={rows().length}>
				<button type="button" class="secondary-action" onClick={clearFilters}>
					絞り込みを解除
				</button>
			</Show>
		</div>
	);
	const PersonButton: Component<{ row: ReviewerRowDto }> = (person) => (
		<button
			type="button"
			class="review-person-link"
			disabled={!canOpen(person.row)}
			onClick={(event) => {
				event.stopPropagation();
				open(person.row);
			}}
		>
			<strong>{person.row.employeeName}</strong>
			<small>{person.row.employeeNo}</small>
		</button>
	);
	const SummaryTable: Component<{ people: ReviewerRowDto[] }> = (table) => (
		<div class="review-table-scroll">
			<table class="review-table">
				<thead>
					<tr>
						<th scope="col">
							<span class="visually-hidden">比較に選択</span>
						</th>
						<th scope="col">評価対象者</th>
						<th scope="col">等級</th>
						<th scope="col">状態</th>
						<th scope="col">一次評価者</th>
						<th scope="col" class="numeric">
							一次評価
						</th>
						<th scope="col" class="numeric">
							最終評価
						</th>
						<th scope="col">最終更新</th>
						<th scope="col">
							<span class="visually-hidden">開く</span>
						</th>
					</tr>
				</thead>
				<tbody>
					<For each={table.people}>
						{(row) => (
							// 行のどこを押しても開ける。キーボード操作の入口として氏名のボタンも残す
							<tr
								class="review-row"
								classList={{ openable: canOpen(row), mine: isMyTurn(row) }}
								title={canOpen(row) ? undefined : "本人が提出すると開けるようになります"}
								onClick={() => open(row)}
							>
								<td>
									<input
										type="checkbox"
										aria-label={`${row.employeeName}を比較に選択`}
										checked={selected().has(row.employeeId)}
										disabled={
											!canOpen(row) || (!selected().has(row.employeeId) && selected().size >= 6)
										}
										onClick={(event) => event.stopPropagation()}
										onChange={() => toggleSelection(row)}
									/>
								</td>
								<td>
									<PersonButton row={row} />
								</td>
								<td>{row.gradeName}</td>
								<td>
									<Badge row={row} />
								</td>
								<td>
									<button
										type="button"
										class="review-evaluator-label"
										aria-label={`一次評価者 ${row.primaryEvaluator}の部下で絞り込む`}
										onClick={(event) => {
											event.stopPropagation();
											setPrimaryEvaluator(String(row.primaryEvaluatorId ?? "unassigned"));
										}}
									>
										{row.primaryEvaluator}
									</button>
								</td>
								<td class="numeric">
									<ScoreRank row={row} stage="first" />
								</td>
								<td class="numeric">
									<ScoreRank row={row} stage="final" />
								</td>
								<td class="review-date">{row.updatedAt ? formatDateTime(row.updatedAt) : "—"}</td>
								<td class="review-row__chevron">
									<Show when={canOpen(row)}>
										<ChevronRight size={18} />
									</Show>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);

	const Comparison: Component<{ people: ReviewerRowDto[] }> = (comparison) => {
		const first = () => comparison.people[0];
		const items = createMemo(() => [
			...new Map(
				comparison.people.flatMap((row) => row.commonItems.map((item) => [item.id, item] as const)),
			).values(),
		]);
		const gap = (row: ReviewerRowDto) => {
			const second = reviewScore(row, "second");
			if (second === null) {
				return "—";
			}
			const difference = second - (reviewScore(row, "first") ?? 0);
			return `${difference > 0 ? "+" : ""}${difference}`;
		};
		return (
			<section class="review-comparison-group">
				<header>
					<div>
						<h2>{first()?.gradeName}</h2>
						<p>{comparison.people.length} 名 · 同じ等級で比較</p>
					</div>
				</header>
				<Show when={detailedComparison()} fallback={<SummaryTable people={comparison.people} />}>
					<div class="review-table-scroll">
						<table class="review-matrix">
							<thead>
								<tr>
									<th scope="col">比較項目</th>
									<For each={comparison.people}>
										{(row) => (
											<th scope="col">
												<PersonButton row={row} />
												<Badge row={row} />
											</th>
										)}
									</For>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th scope="row">一次評価者</th>
									<For each={comparison.people}>{(row) => <td>{row.primaryEvaluator}</td>}</For>
								</tr>
								<tr>
									<th scope="row">一次評価点 / ランク</th>
									<For each={comparison.people}>
										{(row) => (
											<td class="review-score-large">
												<ScoreRank row={row} stage="first" />
											</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">二次評価点</th>
									<For each={comparison.people}>
										{(row) => (
											<td class="review-score-large">{scoreText(reviewScore(row, "second"))}</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">一次・二次の差</th>
									<For each={comparison.people}>{(row) => <td>{gap(row)}</td>}</For>
								</tr>
								<tr>
									<th scope="row">最終評価点 / ランク</th>
									<For each={comparison.people}>
										{(row) => (
											<td class="review-score-large">
												<ScoreRank row={row} stage="final" />
											</td>
										)}
									</For>
								</tr>
								<For
									each={[
										...new Set(
											comparison.people.flatMap((row) =>
												row.objectives.map((goal) => goal.goalNumber),
											),
										),
									].sort((a, b) => a - b)}
								>
									{(goalNumber) => (
										<tr>
											<th scope="row">チャレンジ目標 {goalNumber}</th>
											<For each={comparison.people}>
												{(row) => {
													const goal = () =>
														row.objectives.find((item) => item.goalNumber === goalNumber);
													return (
														<td>
															<p class="review-evidence">{goal()?.challengeGoal || "—"}</p>
															<p class="review-evidence muted">
																{goal()?.achievement || "達成状況の記載なし"}
															</p>
															<small>
																一次 {goal()?.firstScore ?? "—"} / 二次 {goal()?.secondScore ?? "—"}{" "}
																/ 配点 4
															</small>
														</td>
													);
												}}
											</For>
										</tr>
									)}
								</For>
								<For each={items()}>
									{(item) => (
										<tr>
											<th scope="row">
												{item.title}
												<small>配点 {item.weight}</small>
											</th>
											<For each={comparison.people}>
												{(row) => {
													const result = () =>
														row.commonItems.find((entry) => entry.id === item.id);
													return (
														<td>
															<strong>
																一次 {result()?.firstScore ?? "—"} / 二次{" "}
																{result()?.secondScore ?? "—"}
															</strong>
															<p class="review-evidence muted">
																{result()?.firstComment || "コメントなし"}
															</p>
														</td>
													);
												}}
											</For>
										</tr>
									)}
								</For>
								<tr>
									<th scope="row">一次総評</th>
									<For each={comparison.people}>
										{(row) => (
											<td>
												<p class="review-evidence">{row.firstOverallComment || "記載なし"}</p>
											</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">二次総評</th>
									<For each={comparison.people}>
										{(row) => (
											<td>
												<p class="review-evidence">
													{row.canViewSecond ? row.secondOverallComment || "記載なし" : "—"}
												</p>
											</td>
										)}
									</For>
								</tr>
							</tbody>
						</table>
					</div>
				</Show>
			</section>
		);
	};

	return (
		<div class="review-workspace">
			<header class="review-heading">
				<div>
					<span class="review-eyebrow">REVIEW WORKSPACE</span>
					<h1>部下の評価</h1>
				</div>
				<div class="review-heading-actions">
					<label class="review-period">
						<span>評価期間</span>
						<select
							aria-label="評価期間"
							value={periodId() ?? ""}
							onChange={(e) => void navigate({ period: e.currentTarget.value, sheet: undefined })}
						>
							<For each={periods()}>
								{(period) => (
									<option value={period.id}>
										{period.periodName}
										{period.isActive ? " · 実施中" : ""}
									</option>
								)}
							</For>
						</select>
					</label>
					<button
						type="button"
						class="review-icon-button"
						aria-label="部下の一覧を再読み込み"
						title="再読み込み"
						disabled={mutationBusy()}
						onClick={() => void refresh()}
					>
						<RotateCw size={18} classList={{ "review-spinning": refreshing() }} />
					</button>
				</div>
			</header>
			{/* 「自分の番」ごとの件数が、そのまま一覧の絞り込みになる */}
			<div class="review-overview">
				<div class="review-progress">
					<div>
						<Users size={18} />
						<span>
							部下 <strong>{rows().length}</strong> 名
						</span>
						<span class="review-progress-count">
							最終評価済み <strong>{count("finalized")}</strong> / {rows().length}
						</span>
					</div>
					<progress
						aria-label="部下の最終評価の進捗"
						value={count("finalized")}
						max={Math.max(1, rows().length)}
					/>
				</div>
				<For each={stats()}>
					{([key, label, total]) => (
						<button
							type="button"
							class="review-stat"
							classList={{ action: (key === "first" || key === "second") && total > 0 }}
							aria-pressed={filter() === key}
							onClick={() => setFilter(key)}
						>
							<span>{label}</span>
							<strong>
								{total}
								<small>名</small>
							</strong>
						</button>
					)}
				</For>
			</div>
			<div class="review-navigation">
				<div class="review-mode-tabs">
					<For
						each={
							[
								["list", "一覧", Users],
								["evaluate", "評価", ClipboardCheck],
								["compare", "横断比較", Columns3],
							] as const
						}
					>
						{([key, label, Icon]) => (
							<button
								type="button"
								aria-pressed={mode() === key}
								onClick={() =>
									void navigate({
										mode: key,
										detail: key === "compare" && selected().size ? "1" : undefined,
									})
								}
							>
								<Icon size={16} />
								{label}
							</button>
						)}
					</For>
				</div>
				<span class="review-sync" role="status">
					{refreshing()
						? "更新中…"
						: syncedAt()
							? `${formatDateTime(syncedAt() as string)} 時点`
							: ""}
				</span>
			</div>
			<Show when={error()}>
				<div class="inline-alert" role="alert">
					<span>{error()}</span>
					<button type="button" class="secondary-action" onClick={() => void refresh()}>
						再読み込み
					</button>
				</div>
			</Show>
			<Show
				when={!loading()}
				fallback={
					<div class="review-empty" role="status">
						部下の一覧を読み込んでいます…
					</div>
				}
			>
				<Filters />
				<Show when={primaryEvaluatorLabel()}>
					{(label) => (
						<div class="review-active-filter">
							<Users size={14} />
							<span>一次評価者</span>
							<strong>{label().name}</strong>
							<span>の部下を表示</span>
							<button
								type="button"
								aria-label="一次評価者の絞り込みを解除"
								onClick={() => setPrimaryEvaluator("")}
							>
								解除 ×
							</button>
						</div>
					)}
				</Show>
				<Show
					when={periods().length}
					fallback={
						<div class="review-empty">
							<h2>評価期間がまだありません</h2>
						</div>
					}
				>
					<Show
						when={mode() !== "evaluate"}
						fallback={
							<div class="review-split">
								<aside class="review-caseload" aria-label="部下の一覧">
									<header>
										<strong>対象者</strong>
										<span>{visible().length} 名</span>
									</header>
									<Show when={visible().length} fallback={<Empty />}>
										<div class="review-caseload-list">
											<For each={visible()}>
												{(row) => (
													<button
														type="button"
														class="review-caseload-person"
														aria-label={`${row.employeeName}の評価を開く`}
														aria-pressed={current()?.employeeId === row.employeeId}
														disabled={!canOpen(row)}
														onClick={() => open(row)}
													>
														<span class="review-avatar">{row.employeeName.slice(0, 1)}</span>
														<span class="review-caseload-person-info">
															<strong>{row.employeeName}</strong>
															<small>{row.gradeName}</small>
															<Badge row={row} />
														</span>
														<Show when={reviewRank(row, "final") ?? reviewRank(row, "first")}>
															{(rank) => (
																<span
																	class="review-mini-rank"
																	classList={{ provisional: !rank().confirmed }}
																>
																	{rank().text}
																</span>
															)}
														</Show>
													</button>
												)}
											</For>
										</div>
									</Show>
								</aside>
								<div class="review-detail">
									<Show
										when={current()}
										fallback={
											<div class="review-empty">
												<ClipboardCheck size={34} />
												<h2>評価する対象者を選んでください</h2>
												<p>左の一覧から選択すると、ここで評価を進められます。</p>
												<Show when={next()}>
													{(target) => (
														<button
															type="button"
															class="primary-action"
															onClick={() => open(target())}
														>
															自分の番のシートから開始 <ArrowRight size={16} />
														</button>
													)}
												</Show>
											</div>
										}
									>
										{(row) => (
											<>
												<div class="review-detail-toolbar">
													<div>
														<Badge row={row()} />
														<span>一次評価者 {row().primaryEvaluator}</span>
													</div>
													<button
														type="button"
														class="secondary-action"
														disabled={!next() || mutationBusy()}
														onClick={() => {
															const target = next();
															if (target) {
																open(target);
															}
														}}
													>
														次の自分の番へ <ArrowRight size={16} />
													</button>
												</div>
												<Show
													when={sheetStatus(row())?.isAwaitingFirstEvaluation() && !row().isPrimary}
												>
													<p class="review-notice muted">
														一次評価者（{row().primaryEvaluator}
														）が一次評価を確定すると、二次評価を入力できるようになります。
													</p>
												</Show>
												<Show
													when={
														sheetStatus(row())?.isAwaitingSecondEvaluation() && !row().canViewFinal
													}
												>
													<p class="review-notice muted">
														一次評価は確定済みです。二次評価者の確定を待っています。
													</p>
												</Show>
												<Show when={editorIdentity()} keyed>
													{(identity) => (
														<SheetEditorView
															{...props.editor}
															embedded
															selectedSheetId={identity.sheetId as number}
															onUpdated={updateRows}
															onSavingChange={setEditorSaving}
															announceNext={announceNext}
															onStageCompleted={() => void advance()}
														/>
													)}
												</Show>
											</>
										)}
									</Show>
								</div>
							</div>
						}
					>
						<div class="review-results-header">
							<span>
								{visible().length} 名を表示
								<Show when={mode() === "compare"}> · 等級ごとに比較</Show>
							</span>
							<div>
								<Show when={selected().size}>
									<button type="button" onClick={clearSelection}>
										選択を解除
									</button>
								</Show>
								<button
									type="button"
									class="secondary-action"
									disabled={!selectionCount()}
									onClick={() => void navigate({ mode: "compare", detail: "1" })}
								>
									<Columns3 size={16} />
									選択して比較 {selectionCount()} / 6
								</button>
							</div>
						</div>
						<Show when={visible().length} fallback={<Empty />}>
							<Show when={mode() === "compare"} fallback={<SummaryTable people={visible()} />}>
								<p class="review-comparison-help">
									評価点は「設定」の配点（チャレンジ目標＋共通評価で100点）で換算。詳細は一覧で最大6名を選択して比較できます。
								</p>
								<Show
									when={groups().length}
									fallback={
										<p class="review-notice">
											選択した対象者が絞り込み条件に含まれていません。選択か絞り込みを解除してください。
										</p>
									}
								>
									<For each={groups()}>{(people) => <Comparison people={people} />}</For>
								</Show>
							</Show>
						</Show>
					</Show>
				</Show>
			</Show>
		</div>
	);
};

export default ReviewerWorkspaceView;
