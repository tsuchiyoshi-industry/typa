import { useSearchParams } from "@solidjs/router";
import {
	ArrowRight,
	Check,
	CheckCheck,
	ChevronLeft,
	ClipboardCheck,
	Columns3,
	ListFilter,
	RotateCw,
	Search,
	Users,
} from "lucide-solid";
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
	filterReviewRows,
	finalScore,
	isPending,
	nextPending,
	type ReviewFilter,
	type ReviewSort,
	reviewLabel,
	reviewScore,
} from "../viewmodels/reviewerWorkspace";
import { clearUnsavedChanges, confirmDiscard, hasUnsavedChanges, showToast } from "./feedback";
import { formatDateTime } from "./format";
import SheetEditorView, { type SheetEditorViewProps } from "./SheetEditorView";

interface Props {
	controller: ReviewerWorkspaceController;
	editor: SheetEditorViewProps;
}

const scoreText = (value: number | null) => (value === null ? "—" : String(value));
const roleLabel = (row: ReviewerRowDto) =>
	row.role === "secondary" ? "二次評価" : row.canViewFinal ? "一次・最終" : "一次評価";
const Badge: Component<{ row: ReviewerRowDto }> = (props) => (
	<span
		class="review-badge"
		classList={{
			done: props.row.reviewed || props.row.status === "finalized",
			attention: props.row.needsRecheck && props.row.status === "submitted",
			waiting: props.row.status === "missing" || props.row.status === "draft",
		}}
	>
		{reviewLabel(props.row)}
	</span>
);

const ReviewerWorkspaceView: Component<Props> = (props) => {
	const [params, setParams] = useSearchParams();
	const [periods, setPeriods] = createSignal<ReviewPeriodDto[]>([]);
	const [rows, setRows] = createSignal<ReviewerRowDto[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [refreshing, setRefreshing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [marking, setMarking] = createSignal(false);
	const [editorSaving, setEditorSaving] = createSignal(false);
	const [editorRefresh, setEditorRefresh] = createSignal(0);
	const [query, setQuery] = createSignal("");
	const [grade, setGrade] = createSignal("");
	const [role, setRole] = createSignal("");
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
		rows().find((row) => row.sheetId !== null && String(row.sheetId) === params.sheet),
	);
	const visible = createMemo(() =>
		filterReviewRows(rows(), {
			query: query(),
			grade: grade(),
			role: role(),
			primaryEvaluator: primaryEvaluator(),
			filter: filter(),
			sort: sort(),
		}),
	);
	const grades = createMemo(() => [
		...new Map(rows().map((row) => [String(row.gradeId ?? "unset"), row.gradeName])).entries(),
	]);
	const primaryEvaluators = createMemo(() => {
		const labels = new Map<string, { id: string; name: string; count: number }>();
		for (const row of rows()) {
			const id = String(row.primaryEvaluatorId ?? "unassigned");
			const label = labels.get(id) ?? { id, name: row.primaryEvaluator, count: 0 };
			label.count += 1;
			labels.set(id, label);
		}
		return [...labels.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
	});
	const primaryEvaluatorLabel = createMemo(() =>
		primaryEvaluators().find((label) => label.id === primaryEvaluator()),
	);
	const counts = createMemo(() => ({
		pending: rows().filter(isPending).length,
		recheck: rows().filter((row) => row.status === "submitted" && row.needsRecheck).length,
		waiting: rows().filter((row) => row.status === "missing" || row.status === "draft").length,
		reviewed: rows().filter((row) => row.status === "submitted" && row.reviewed).length,
		finalized: rows().filter((row) => row.status === "finalized").length,
	}));
	const finished = () => counts().reviewed + counts().finalized;
	const next = createMemo(() => nextPending(visible(), current()?.employeeId));
	const detailedComparison = () => params.detail === "1" && selected().size > 0;
	const comparisonRows = createMemo(() =>
		detailedComparison() ? visible().filter((row) => selected().has(row.employeeId)) : visible(),
	);
	const groups = createMemo(() => {
		const grouped = new Map<string, ReviewerRowDto[]>();
		for (const row of comparisonRows()) {
			const key = String(row.gradeId ?? "unset");
			grouped.set(key, [...(grouped.get(key) ?? []), row]);
		}
		return [...grouped.values()];
	});
	const mutationBusy = () => marking() || refreshing() || loading() || editorSaving();
	const currentSheetId = createMemo(() => current()?.sheetId);
	const editorIdentity = createMemo(() => ({
		sheetId: currentSheetId(),
		refresh: editorRefresh(),
	}));
	const confirmationBlocked = () => {
		const model = props.editor.viewModel();
		return (
			mutationBusy() ||
			!!error() ||
			model.loadingSheet ||
			!!model.fetchError ||
			model.sheet?.sheetId !== current()?.sheetId ||
			!model.canViewCommonEvaluation ||
			props.editor.commonEvaluationViewModel().loading ||
			!!props.editor.commonEvaluationViewModel().loadError
		);
	};

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
				loaded.some((row) => String(row.primaryEvaluatorId ?? "unassigned") === previous)
					? previous
					: "",
			);
			setGrade((previous) =>
				loaded.some((row) => String(row.gradeId ?? "unset") === previous) ? previous : "",
			);
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
						: ((reason as { message?: string })?.message ?? "受け持ちを読み込めませんでした。"),
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
		if (marking()) {
			return;
		}
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
		if (row.sheetId !== null) {
			void navigate({ sheet: row.sheetId, mode: "evaluate", period: periodId() ?? undefined });
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
	const mark = async (advance: boolean) => {
		const row = current();
		const id = periodId();
		if (!row?.sheetId || !row.revision || !id || confirmationBlocked()) {
			return;
		}
		if (hasUnsavedChanges()) {
			showToast("info", "先に入力内容を保存してください");
			return;
		}
		setMarking(true);
		try {
			await props.controller.setReviewed(row.sheetId, row.revision, advance || !row.reviewed);
			const loaded = await load(id);
			if (!alive) {
				return;
			}
			showToast(
				"success",
				!advance && row.reviewed ? "確認済みを解除しました" : "確認済みにしました",
			);
			if (advance && loaded) {
				const filtered = filterReviewRows(loaded, {
					query: query(),
					grade: grade(),
					role: role(),
					primaryEvaluator: primaryEvaluator(),
					filter: filter(),
					sort: sort(),
				});
				const target = nextPending(filtered, row.employeeId);
				if (target?.sheetId) {
					setParams({ sheet: target.sheetId, mode: "evaluate" }, { scroll: false });
				} else {
					showToast("success", "この一覧の未確認はすべて確認できました");
				}
			}
		} catch (reason) {
			showToast(
				"error",
				"確認を記録できませんでした",
				(reason as { message?: string })?.message ?? "再読み込みしてお試しください。",
			);
		} finally {
			if (alive) {
				setMarking(false);
			}
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
		setRole("");
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
				<span class="visually-hidden">受け持ちを検索</span>
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
								{label.name} · {label.count}人
							</option>
						)}
					</For>
				</select>
			</label>
			<label>
				<span class="visually-hidden">担当で絞り込み</span>
				<select value={role()} onChange={(e) => setRole(e.currentTarget.value)}>
					<option value="">すべての担当</option>
					<option value="primary">一次評価</option>
					<option value="secondary">二次評価</option>
				</select>
			</label>
			<label>
				<span class="visually-hidden">表示順</span>
				<select value={sort()} onChange={(e) => setSort(e.currentTarget.value as ReviewSort)}>
					<option value="priority">対応が必要な順</option>
					<option value="name">氏名順</option>
					<option value="firstScore">一次評価点順</option>
					<option value="finalScore">最終評価点順</option>
					<option value="gap">一次・二次の差が大きい順</option>
				</select>
			</label>
		</div>
	);
	const FilterTabs = () => (
		<fieldset class="review-filter-tabs">
			<legend class="visually-hidden">確認状況で絞り込み</legend>
			<For
				each={
					[
						["all", "全員", rows().length],
						["pending", "未確認", counts().pending],
						["recheck", "再確認", counts().recheck],
						["waiting", "提出待ち", counts().waiting],
						["reviewed", "確認済み", counts().reviewed],
						["finalized", "確定済み", counts().finalized],
					] as const
				}
			>
				{([key, label, count]) => (
					<button type="button" aria-pressed={filter() === key} onClick={() => setFilter(key)}>
						{label}
						<span>{count}</span>
					</button>
				)}
			</For>
		</fieldset>
	);
	const Empty = () => (
		<div class="review-empty">
			<ListFilter size={28} />
			<h2>{rows().length ? "条件に合う対象者がいません" : "この期間の受け持ちはありません"}</h2>
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
			disabled={person.row.sheetId === null || marking()}
			onClick={() => open(person.row)}
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
						<th scope="col">等級 / 担当</th>
						<th scope="col">一次評価</th>
						<th scope="col">自分の確認</th>
						<th scope="col" class="numeric">
							一次評価点
						</th>
						<th scope="col" class="numeric">
							二次評価点
						</th>
						<th scope="col" class="numeric">
							最終評価点
						</th>
						<th scope="col" class="numeric">
							最終ランク
						</th>
						<th scope="col">最終更新</th>
					</tr>
				</thead>
				<tbody>
					<For each={table.people}>
						{(row) => (
							<tr>
								<td>
									<input
										type="checkbox"
										aria-label={`${row.employeeName}を比較に選択`}
										checked={selected().has(row.employeeId)}
										disabled={
											row.sheetId === null ||
											(!selected().has(row.employeeId) && selected().size >= 6)
										}
										onChange={() => toggleSelection(row)}
									/>
								</td>
								<td>
									<PersonButton row={row} />
								</td>
								<td>
									<span>{row.gradeName}</span>
									<small>{roleLabel(row)}</small>
								</td>
								<td>
									<span classList={{ "review-positive": row.primaryReviewed }}>
										{row.sheetId === null ? "—" : row.primaryReviewed ? "確認済み" : "未確認"}
									</span>
									<button
										type="button"
										class="review-evaluator-label"
										aria-label={`一次評価者 ${row.primaryEvaluator}の受け持ちで絞り込む`}
										onClick={() =>
											setPrimaryEvaluator(String(row.primaryEvaluatorId ?? "unassigned"))
										}
									>
										{row.primaryEvaluator}
									</button>
								</td>
								<td>
									<Badge row={row} />
								</td>
								<td class="numeric">{scoreText(reviewScore(row, "first"))}</td>
								<td class="numeric">{scoreText(reviewScore(row, "second"))}</td>
								<td class="numeric">{scoreText(finalScore(row))}</td>
								<td class="numeric">
									<strong>{row.finalRank ?? "—"}</strong>
								</td>
								<td class="review-date">{row.updatedAt ? formatDateTime(row.updatedAt) : "—"}</td>
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
		return (
			<section class="review-comparison-group">
				<header>
					<div>
						<h2>{first()?.gradeName}</h2>
						<p>{comparison.people.length} 人 · 同じ等級で比較</p>
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
									<For each={comparison.people}>
										{(row) => (
											<td>
												{row.primaryEvaluator}
												<small>{row.primaryReviewed ? "一次確認済み" : "一次未確認"}</small>
											</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">一次評価点 / 100</th>
									<For each={comparison.people}>
										{(row) => (
											<td class="review-score-large">{scoreText(reviewScore(row, "first"))}</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">二次評価点 / 100</th>
									<For each={comparison.people}>
										{(row) => (
											<td class="review-score-large">{scoreText(reviewScore(row, "second"))}</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">一次・二次の差</th>
									<For each={comparison.people}>
										{(row) => (
											<td>
												{row.canViewSecond
													? `${(reviewScore(row, "second") ?? 0) - (reviewScore(row, "first") ?? 0) > 0 ? "+" : ""}${(reviewScore(row, "second") ?? 0) - (reviewScore(row, "first") ?? 0)}`
													: "—"}
											</td>
										)}
									</For>
								</tr>
								<tr>
									<th scope="row">最終評価点 / ランク</th>
									<For each={comparison.people}>
										{(row) => (
											<td>
												<strong>
													{scoreText(finalScore(row))} / {row.finalRank ?? "—"}
												</strong>
											</td>
										)}
									</For>
								</tr>
								<For each={[1, 2]}>
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
					<h1>受け持ちの評価</h1>
					<p>進捗を見渡し、一人ずつ確認。同じ等級で判断を揃える。</p>
				</div>
				<div class="review-heading-actions">
					<label class="review-period">
						<span>評価期間</span>
						<select
							aria-label="評価期間"
							value={periodId() ?? ""}
							disabled={marking()}
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
						aria-label="受け持ちを再読み込み"
						title="再読み込み"
						disabled={mutationBusy()}
						onClick={() => void refresh()}
					>
						<RotateCw size={18} classList={{ "review-spinning": refreshing() }} />
					</button>
				</div>
			</header>
			<div class="review-overview">
				<div class="review-progress">
					<div>
						<Users size={18} />
						<span>
							受け持ち <strong>{rows().length}</strong> 人
						</span>
						<span class="review-progress-count">
							確認・確定 <strong>{finished()}</strong> / {rows().length}
						</span>
					</div>
					<progress
						aria-label="受け持ちの確認・確定進捗"
						value={finished()}
						max={Math.max(1, rows().length)}
					/>
				</div>
				<For
					each={
						[
							["pending", "未確認", counts().pending],
							["waiting", "提出待ち・未作成", counts().waiting],
							["reviewed", "確認済み", counts().reviewed],
							["finalized", "確定済み", counts().finalized],
						] as const
					}
				>
					{([key, label, count]) => (
						<button
							type="button"
							class="review-stat"
							aria-pressed={filter() === key}
							onClick={() => setFilter(key)}
						>
							<span>{label}</span>
							<strong>
								{count}
								<small>人</small>
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
								disabled={marking()}
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
						受け持ちを読み込んでいます…
					</div>
				}
			>
				<Filters />
				<FilterTabs />
				<Show when={primaryEvaluatorLabel()}>
					{(label) => (
						<div class="review-active-filter">
							<Users size={14} />
							<span>一次評価者</span>
							<strong>{label().name}</strong>
							<span>の受け持ちを表示</span>
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
								<aside class="review-caseload" aria-label="受け持ち一覧">
									<header>
										<strong>対象者</strong>
										<span>{visible().length} 人</span>
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
														disabled={row.sheetId === null || marking()}
														onClick={() => open(row)}
													>
														<span class="review-avatar">{row.employeeName.slice(0, 1)}</span>
														<span class="review-caseload-person-info">
															<strong>{row.employeeName}</strong>
															<small>
																{row.gradeName} · {roleLabel(row)}
															</small>
															<Badge row={row} />
														</span>
														<Show when={row.canViewFinal && row.finalRank}>
															<span class="review-mini-rank">{row.finalRank}</span>
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
												<h2>確認する対象者を選んでください</h2>
												<p>左の一覧から選択すると、ここで評価を進められます。</p>
												<Show when={next()}>
													{(target) => (
														<button
															type="button"
															class="primary-action"
															onClick={() => open(target())}
														>
															未確認から開始 <ArrowRight size={16} />
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
														<span>{roleLabel(row())}</span>
														<Show when={row().reviewedAt}>
															<small>{formatDateTime(row().reviewedAt as string)} に確認</small>
														</Show>
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
														次の未確認者へ <ArrowRight size={16} />
													</button>
												</div>
												<Show when={row().needsRecheck && row().status === "submitted"}>
													<p class="review-notice">
														前回の確認後に内容が更新されています。変更内容を確認してください。
													</p>
												</Show>
												<Show
													when={
														row().status === "submitted" &&
														row().role === "secondary" &&
														!row().primaryReviewed
													}
												>
													<p class="review-notice muted">
														一次評価者の確認はまだ記録されていません。点数の入力と確認記録は別に扱います。
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
														/>
													)}
												</Show>
												<Show when={row().status === "submitted"}>
													<footer class="review-action-bar">
														<div>
															<CheckCheck size={18} />
															<span>{row().employeeName}の内容を確認して記録</span>
															<small>確認記録後も、確定するまでは評価を編集できます。</small>
														</div>
														<button
															type="button"
															class="secondary-action"
															disabled={confirmationBlocked()}
															onClick={() => void mark(false)}
														>
															{row().reviewed ? "確認済みを解除" : "確認済みにする"}
														</button>
														<button
															type="button"
															class="primary-action"
															disabled={confirmationBlocked()}
															onClick={() => void mark(true)}
														>
															<Check size={16} />
															{marking() ? "記録中…" : "確認して次へ"}
															<ArrowRight size={16} />
														</button>
													</footer>
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
								{visible().length} 人を表示
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
									一次・二次評価点は目標20点＋共通評価80点で換算。点数と確認記録を分けて表示しています。詳細は一覧で最大6人を選択して比較できます。
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
			<footer class="review-footnote">
				<CheckCheck size={14} />
				<span>
					確認記録は評価者ごとに保存されます。確認後の内容変更は再確認として表示されます。
				</span>
				<button type="button" onClick={() => void navigate({ mode: "list" })}>
					<ChevronLeft size={14} />
					一覧へ
				</button>
			</footer>
		</div>
	);
};

export default ReviewerWorkspaceView;
