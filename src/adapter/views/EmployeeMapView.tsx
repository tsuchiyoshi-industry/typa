import {
	ChevronDown,
	ChevronRight,
	GitFork,
	Maximize2,
	Minus,
	Plus,
	RefreshCw,
	Search,
	X,
} from "lucide-solid";
import {
	type Component,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { EmployeeMapDto } from "../../application/dtos/EmployeeMapDto";
import { buildEmployeeForest, layoutEmployeeForest, type MapMode } from "../viewmodels/employeeMap";

const EmployeeMapView: Component<{ load: () => Promise<EmployeeMapDto> }> = (props) => {
	const [data, setData] = createSignal<EmployeeMapDto | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [mode, setMode] = createSignal<MapMode>("primary");
	const [query, setQuery] = createSignal("");
	const [selectedId, setSelectedId] = createSignal<number | null>(null);
	const [collapsed, setCollapsed] = createSignal(new Set<number>());
	const [zoom, setZoom] = createSignal(1);
	const id = createUniqueId();
	let stage!: HTMLElement;
	let request = 0;
	const reload = async () => {
		const current = ++request;
		setLoading(true);
		setError(null);
		setData(null);
		setSelectedId(null);
		setCollapsed(new Set<number>());
		try {
			const response = await props.load();
			if (request === current) {
				setData(response);
			}
		} catch (cause) {
			if (request === current) {
				setError(cause instanceof Error ? cause.message : "マップを取得できませんでした。");
			}
		} finally {
			if (request === current) {
				setLoading(false);
			}
		}
	};
	onMount(() => void reload());
	onCleanup(() => request++);
	const people = () => data()?.people ?? [];
	const forest = createMemo(() => buildEmployeeForest(people(), mode()));
	const layout = createMemo(() => layoutEmployeeForest(forest().root, collapsed()));
	const selected = () => forest().byId.get(selectedId() ?? -1);
	const matches = createMemo(() => {
		const term = query().trim().normalize("NFKC").toLocaleLowerCase();
		return term
			? people().filter((person) =>
					`${person.name} ${person.employeeNo}`
						.normalize("NFKC")
						.toLocaleLowerCase()
						.includes(term),
				)
			: [];
	});
	const selectedPath = createMemo(() => {
		const ids = new Set<number>();
		let current = selectedId();
		while (current != null && !ids.has(current)) {
			ids.add(current);
			current = forest().parents.get(current) ?? null;
		}
		return ids;
	});
	const reviewers = createMemo(
		() =>
			new Set(
				people()
					.flatMap((person) => [person.primaryEvaluatorId, person.secondaryEvaluatorId])
					.filter((value) => value !== null && forest().byId.has(value)),
			).size,
	);
	const choose = (employeeId: number) => {
		setSelectedId(employeeId);
		const next = new Set(collapsed());
		let parent = forest().parents.get(employeeId) ?? null;
		while (parent !== null) {
			next.delete(parent);
			parent = forest().parents.get(parent) ?? null;
		}
		setCollapsed(next);
		queueMicrotask(() =>
			document
				.getElementById(`${id}-person-${employeeId}`)
				?.scrollIntoView?.({ block: "nearest", inline: "center" }),
		);
	};
	const toggle = (employeeId: number) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(employeeId)) {
				next.delete(employeeId);
			} else {
				next.add(employeeId);
			}
			return next;
		});
	const fit = () => {
		setZoom(Math.max(0.2, Math.min(1, (stage.clientWidth - 32) / layout().width)));
		stage.scrollTo?.({ top: 0, left: 0 });
	};
	const nameOf = (employeeId: number | null) =>
		employeeId === null ? "未設定" : (forest().byId.get(employeeId)?.name ?? "参照先不明");
	return (
		<div class="employee-map-page">
			<header class="master-header">
				<div>
					<h1>
						<GitFork size={25} />
						マップ
					</h1>
					<p>評価者と社員のつながりを、階層で確認できます。</p>
				</div>
				<span class="map-readonly">閲覧専用</span>
			</header>
			<Show when={error()}>
				<div class="inline-alert" role="alert">
					{error()}
					<button class="secondary-action" type="button" onClick={() => void reload()}>
						再読み込み
					</button>
				</div>
			</Show>
			<Show when={loading()}>
				<p class="page-note" role="status">
					評価者マップを読み込んでいます…
				</p>
			</Show>
			<Show when={data()}>
				<div class="map-summary">
					<div>
						<span>社員</span>
						<strong>
							{people().length}
							<small>名</small>
						</strong>
					</div>
					<div>
						<span>担当を持つ評価者</span>
						<strong>
							{reviewers()}
							<small>名</small>
						</strong>
					</div>
					<div>
						<span>最上位・独立した枝</span>
						<strong>
							{forest().root.children.length}
							<small>件</small>
						</strong>
					</div>
					<div classList={{ "map-warning": forest().issues.size > 0 }}>
						<span>関係の確認が必要</span>
						<strong>
							{forest().issues.size}
							<small>名</small>
						</strong>
					</div>
				</div>
				<section class="map-workspace" aria-label="評価者マップ">
					<div class="map-toolbar">
						<fieldset class="map-modes" aria-label="表示する評価者">
							<button
								type="button"
								aria-pressed={mode() === "primary"}
								onClick={() => {
									setMode("primary");
									setCollapsed(new Set<number>());
								}}
							>
								一次評価者
							</button>
							<button
								type="button"
								aria-pressed={mode() === "secondary"}
								onClick={() => {
									setMode("secondary");
									setCollapsed(new Set<number>());
								}}
							>
								二次・最終評価者
							</button>
						</fieldset>
						<div class="map-search">
							<Search size={16} />
							<input
								type="search"
								aria-label="マップの社員を検索"
								placeholder="氏名・社員番号を検索"
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
							/>
						</div>
						<button
							class="map-icon-button"
							type="button"
							aria-label="マップを再読み込み"
							disabled={loading()}
							onClick={() => void reload()}
						>
							<RefreshCw size={16} />
						</button>
					</div>
					<div class="map-caption">
						<span class="map-line-sample" />
						上が評価者、下が評価対象の社員です。
						<Show when={mode() === "secondary"}>
							<span>二次評価者「なし」の社員は一次評価者につながります。</span>
						</Show>
						<span>役員も含めて表示しています。</span>
						<Show when={forest().issues.size > 0}>
							<span>
								循環関係は接続を一か所外し、参照先不明の社員は独立した枝として表示します。
							</span>
						</Show>
					</div>
					<Show when={query().trim()}>
						<section class="map-search-results" aria-label="社員の検索結果">
							<span>{matches().length}名一致</span>
							<For each={matches().slice(0, 50)}>
								{(person) => (
									<button type="button" onClick={() => choose(person.id)}>
										{person.name}
										<small>{person.employeeNo}</small>
									</button>
								)}
							</For>
							<Show when={!matches().length}>
								<span>一致する社員がいません。</span>
							</Show>
							<Show when={matches().length > 50}>
								<span>先頭50名を表示。検索を絞り込んでください。</span>
							</Show>
						</section>
					</Show>
					<div class="map-body">
						<section
							class="map-stage"
							ref={stage}
							tabindex="0"
							aria-label="階層図。スクロールで全体を確認できます"
						>
							<Show
								when={people().length}
								fallback={<p class="master-empty">表示できる社員がいません。</p>}
							>
								<div
									class="map-scaled"
									style={{
										width: `${layout().width * zoom()}px`,
										height: `${layout().height * zoom()}px`,
									}}
								>
									<div
										class="map-scene"
										style={{
											width: `${layout().width}px`,
											height: `${layout().height}px`,
											transform: `scale(${zoom()})`,
										}}
									>
										<svg
											width={layout().width}
											height={layout().height}
											aria-hidden="true"
											class="map-links"
										>
											<For each={layout().links}>
												{(link) => (
													<path
														classList={{
															highlighted:
																selectedPath().has(link.source.person.id) &&
																selectedPath().has(link.target.person.id),
															secondary: mode() === "secondary",
														}}
														d={`M${link.source.x + 98},${link.source.y + 78} C${link.source.x + 98},${(link.source.y + 78 + link.target.y) / 2} ${link.target.x + 98},${(link.source.y + 78 + link.target.y) / 2} ${link.target.x + 98},${link.target.y}`}
													/>
												)}
											</For>
										</svg>
										<For each={layout().nodes}>
											{(node) => (
												<div
													class="map-node"
													classList={{
														selected: selectedId() === node.person.id,
														ancestor: selectedPath().has(node.person.id),
														issue: forest().issues.has(node.person.id),
														matched: matches().some((person) => person.id === node.person.id),
														executive: node.person.careerCourse?.trim() === "役員",
													}}
													style={{ left: `${node.x}px`, top: `${node.y}px` }}
												>
													<button
														type="button"
														id={`${id}-person-${node.person.id}`}
														class="map-person"
														aria-label={`${node.person.name} ${node.person.employeeNo} の詳細`}
														aria-pressed={selectedId() === node.person.id}
														onClick={() => choose(node.person.id)}
													>
														<span class="map-person-top">
															<strong>{node.person.name}</strong>
															<small>{node.person.gradeName}</small>
														</span>
														<span class="map-person-meta">
															{node.person.employeeNo}
															<span>{node.person.careerCourse ?? "コース未設定"}</span>
														</span>
														<Show when={forest().issues.has(node.person.id)}>
															<span class="map-person-issue">関係を確認</span>
														</Show>
													</button>
													<Show when={node.children > 0}>
														<button
															class="map-collapse"
															type="button"
															aria-label={`${node.person.name}の配下を${collapsed().has(node.person.id) ? "展開" : "折りたたむ"}`}
															aria-expanded={!collapsed().has(node.person.id)}
															onClick={() => toggle(node.person.id)}
														>
															<Show
																when={collapsed().has(node.person.id)}
																fallback={<ChevronDown size={13} />}
															>
																<ChevronRight size={13} />
															</Show>
															{node.children}
														</button>
													</Show>
												</div>
											)}
										</For>
									</div>
								</div>
							</Show>
						</section>
						<Show when={selected()}>
							{(person) => (
								<aside class="map-detail" aria-label="選択した社員の詳細">
									<div class="map-detail-head">
										<span>社員情報</span>
										<button
											class="map-icon-button"
											type="button"
											aria-label="社員の詳細を閉じる"
											onClick={() => setSelectedId(null)}
										>
											<X size={17} />
										</button>
									</div>
									<h2>{person().name}</h2>
									<p>{person().employeeNo}</p>
									<dl>
										<div>
											<dt>等級</dt>
											<dd>{person().gradeName}</dd>
										</div>
										<div>
											<dt>キャリアコース</dt>
											<dd>{person().careerCourse ?? "未設定"}</dd>
										</div>
										<div>
											<dt>権限</dt>
											<dd>{person().roleName}</dd>
										</div>
										<div>
											<dt>登録</dt>
											<dd>{person().registered ? "登録済み" : "未登録"}</dd>
										</div>
										<div>
											<dt>一次評価者</dt>
											<dd>{nameOf(person().primaryEvaluatorId)}</dd>
										</div>
										<div>
											<dt>二次評価者</dt>
											<dd>
												{person().noSecondaryEvaluator
													? "なし（一次評価が最終）"
													: nameOf(person().secondaryEvaluatorId)}
											</dd>
										</div>
										<div>
											<dt>この表示での直接の担当</dt>
											<dd>{forest().branches.get(person().id)?.children.length ?? 0}名</dd>
										</div>
									</dl>
									<Show when={forest().issues.get(person().id)}>
										<p class="map-detail-warning">{forest().issues.get(person().id)}</p>
									</Show>
								</aside>
							)}
						</Show>
					</div>
					<footer class="map-footer">
						<span>
							{layout().nodes.length} / {people().length}名を表示 · 線は評価関係を表します
						</span>
						<div class="map-zoom">
							<button
								class="map-icon-button"
								type="button"
								aria-label="縮小"
								disabled={zoom() <= 0.2}
								onClick={() => setZoom(Math.max(0.2, zoom() - 0.2))}
							>
								<Minus size={15} />
							</button>
							<span>{Math.round(zoom() * 100)}%</span>
							<button
								class="map-icon-button"
								type="button"
								aria-label="拡大"
								disabled={zoom() >= 1.8}
								onClick={() => setZoom(Math.min(1.8, zoom() + 0.2))}
							>
								<Plus size={15} />
							</button>
							<button type="button" onClick={fit}>
								<Maximize2 size={14} />
								全体表示
							</button>
							<button
								type="button"
								onClick={() => {
									setCollapsed(new Set<number>());
									setZoom(1);
								}}
							>
								展開をリセット
							</button>
						</div>
					</footer>
				</section>
			</Show>
		</div>
	);
};
export default EmployeeMapView;
