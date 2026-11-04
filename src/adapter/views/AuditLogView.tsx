import ScrollText from "lucide-solid/icons/scroll-text";
import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { messageOf } from "../../application/errorMessage";
import type { AuditCategory } from "../../domain/entities/AuditEvent";
import type {
	AuditLogController,
	AuditLogQuery,
	AuditPersonOption,
} from "../controllers/AuditLogController";
import { type AuditEntryView, groupByDay } from "../viewmodels/auditLog";
import SearchableEvaluatorSelect, {
	type EvaluatorOption,
} from "./components/SearchableEvaluatorSelect";
import "./styles/audit.css";

const KINDS: { value: AuditCategory | "all"; label: string }[] = [
	{ value: "all", label: "すべて" },
	{ value: "account", label: "社員・アカウント" },
	{ value: "workflow", label: "評価の進行" },
	{ value: "period", label: "評価期間" },
	{ value: "override", label: "遡及処理" },
	{ value: "import", label: "取込" },
];

const UNFILTERED: AuditLogQuery = {
	category: "all",
	since: "",
	until: "",
	actorEmployeeId: null,
	targetEmployeeId: null,
};

const toOptions = (people: AuditPersonOption[]): EvaluatorOption[] => [
	{ value: "", name: "すべて" },
	...people.map((person) => ({
		value: String(person.id),
		name: person.name,
		employeeNo: person.employeeNo,
	})),
];

const Person: Component<{ name: string; employeeNo: string | null }> = (props) => (
	<span class="audit-person">
		{props.name}
		<Show when={props.employeeNo}>
			<small>{props.employeeNo}</small>
		</Show>
	</span>
);

const Entry: Component<{ entry: AuditEntryView }> = (props) => {
	const entry = () => props.entry;
	return (
		<li
			class="audit-entry"
			data-kind={entry().category}
			classList={{ "audit-entry--sealed": entry().seal !== null }}
		>
			<time class="audit-entry__time" datetime={entry().occurredAt}>
				{entry().time}
			</time>
			<div class="audit-entry__main">
				<h3 class="audit-entry__title">{entry().title}</h3>
				<Show when={entry().subject}>
					{(subject) => (
						<p class="audit-entry__subject">
							<Show when={subject().person}>
								{(person) => <Person name={person().name} employeeNo={person().employeeNo} />}
							</Show>
							<Show when={subject().periodName}>
								<span class="audit-entry__period">{subject().periodName}</span>
							</Show>
							<Show when={subject().missing}>
								<span class="audit-entry__missing">{subject().missing}</span>
							</Show>
							<Show when={subject().sheetId}>
								{(sheetId) => (
									<a class="audit-entry__open" href={`/sheet/${sheetId()}`}>
										シートを開く
									</a>
								)}
							</Show>
						</p>
					)}
				</Show>
				<Show when={entry().changes.length > 0}>
					<dl class="audit-changes">
						<For each={entry().changes}>
							{(change) => (
								<div class="audit-changes__row">
									<dt>{change.label}</dt>
									<dd>
										<del>{change.before}</del>
										<span class="audit-changes__to" aria-hidden="true" />
										<span class="visually-hidden">から</span>
										<ins>{change.after}</ins>
									</dd>
								</div>
							)}
						</For>
					</dl>
				</Show>
				<Show when={entry().facts.length > 0}>
					<dl class="audit-facts">
						<For each={entry().facts}>
							{(fact) => (
								<div>
									<dt>{fact.label}</dt>
									<dd>{fact.value}</dd>
								</div>
							)}
						</For>
					</dl>
				</Show>
				<Show when={entry().reason}>
					{(reason) => (
						<p class="audit-reason">
							<span class="audit-reason__label">理由</span>
							<q>{reason()}</q>
						</p>
					)}
				</Show>
				<details class="audit-raw">
					<summary>記録の原文</summary>
					<pre>{entry().raw}</pre>
				</details>
			</div>
			<p class="audit-entry__actor">
				<span class="audit-entry__label">操作</span>
				<Person name={entry().actor.name} employeeNo={entry().actor.employeeNo} />
			</p>
			<Show when={entry().seal}>
				{(seal) => (
					<span class="audit-seal" role="img" aria-label={`検印：${seal().label}`}>
						{seal().glyph}
					</span>
				)}
			</Show>
		</li>
	);
};

/**
 * 監査ログ(Admin だけ)。誰が・いつ・何に・何をしたかを、日ごとに新しい順で並べる。
 * 読むだけの画面で、記録はアプリから書き換えられない。
 */
const AuditLogView: Component<{ controller: AuditLogController }> = (props) => {
	const [refused, setRefused] = createSignal("");
	const [opened, setOpened] = createSignal(false);
	const [targets, setTargets] = createSignal<EvaluatorOption[]>([]);
	const [actors, setActors] = createSignal<EvaluatorOption[]>([]);
	const [query, setQuery] = createSignal<AuditLogQuery>(UNFILTERED);
	const [entries, setEntries] = createSignal<AuditEntryView[]>([]);
	const [next, setNext] = createSignal<number | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [failure, setFailure] = createSignal("");
	const [loadingMore, setLoadingMore] = createSignal(false);
	const [moreFailure, setMoreFailure] = createSignal("");
	const days = createMemo(() => groupByDay(entries()));
	const filtered = () => {
		const current = query();
		return (Object.keys(UNFILTERED) as (keyof AuditLogQuery)[]).some(
			(key) => current[key] !== UNFILTERED[key],
		);
	};

	// 絞り込みを続けて変えたとき、前の条件の遅い応答で今の一覧を上書きしない
	let generation = 0;
	const reload = async () => {
		const current = ++generation;
		setLoading(true);
		setFailure("");
		setMoreFailure("");
		try {
			const result = await props.controller.page(query(), null);
			if (current !== generation) {
				return;
			}
			setEntries(result.entries);
			setNext(result.next);
		} catch (error) {
			if (current !== generation) {
				return;
			}
			// 前の条件の記録を、今の条件の結果のように見せない
			setEntries([]);
			setNext(null);
			setFailure(messageOf(error, "監査ログを読み込めませんでした。"));
		} finally {
			if (current === generation) {
				setLoading(false);
			}
		}
	};
	const loadMore = async () => {
		const current = generation;
		const before = next();
		setLoadingMore(true);
		setMoreFailure("");
		try {
			const result = await props.controller.page(query(), before);
			if (current !== generation) {
				return;
			}
			setEntries([...entries(), ...result.entries]);
			setNext(result.next);
		} catch (error) {
			if (current === generation) {
				setMoreFailure(messageOf(error, "記録を読み込めませんでした。"));
			}
		} finally {
			if (current === generation) {
				setLoadingMore(false);
			}
		}
	};
	const change = (patch: Partial<AuditLogQuery>) => {
		setQuery({ ...query(), ...patch });
		void reload();
	};

	const clearFilters = () => {
		setQuery(UNFILTERED);
		void reload();
	};

	onMount(async () => {
		try {
			const options = await props.controller.open();
			setTargets(toOptions(options.targets));
			setActors(toOptions(options.actors));
			setOpened(true);
		} catch (error) {
			setRefused(messageOf(error, "監査ログを開けませんでした。"));
			return;
		}
		await reload();
	});

	const pick = (key: "targetEmployeeId" | "actorEmployeeId") => async (value: string) => {
		change({ [key]: value ? Number(value) : null });
		return true;
	};

	return (
		<div class="audit-page">
			<header class="master-header">
				<div>
					<h1>
						<ScrollText class="header-icon" aria-hidden="true" />
						監査ログ
					</h1>
					<p class="audit-lead">
						社員マスタの変更、シートの状態の移り変わり、遡及処理、データの取込を、DB
						が操作と同時に記録したものです。記録はアプリから書き換えも削除もできません。朱の印は、Admin
						が理由を添えて通常の手順を越えた操作です。
					</p>
				</div>
			</header>

			<Show
				when={!refused()}
				fallback={
					<p class="audit-notice" role="alert">
						{refused()}
					</p>
				}
			>
				<Show when={opened()} fallback={<p class="page-note">読み込んでいます...</p>}>
					<search class="audit-filters" aria-label="監査ログの絞り込み">
						<form class="audit-filters__form" onSubmit={(event) => event.preventDefault()}>
							<div class="audit-filters__top">
								<fieldset class="audit-kinds">
									<legend class="visually-hidden">種類</legend>
									<For each={KINDS}>
										{(kind) => (
											<label class="audit-kind">
												<input
													type="radio"
													name="audit-kind"
													value={kind.value}
													checked={query().category === kind.value}
													onChange={() => change({ category: kind.value })}
												/>
												<span>{kind.label}</span>
											</label>
										)}
									</For>
								</fieldset>
								<Show when={filtered()}>
									<button type="button" class="audit-clear" onClick={clearFilters}>
										絞り込みを解除
									</button>
								</Show>
							</div>
							<div class="audit-filters__fields">
								<div class="audit-field">
									<span class="audit-field__label" aria-hidden="true">
										対象の社員
									</span>
									<SearchableEvaluatorSelect
										label="対象の社員"
										noun="社員"
										value={query().targetEmployeeId?.toString() ?? ""}
										options={targets()}
										disabled={false}
										saving={false}
										onPick={pick("targetEmployeeId")}
									/>
								</div>
								<div class="audit-field">
									<span class="audit-field__label" aria-hidden="true">
										操作した人
									</span>
									<SearchableEvaluatorSelect
										label="操作した人"
										noun="社員"
										value={query().actorEmployeeId?.toString() ?? ""}
										options={actors()}
										disabled={false}
										saving={false}
										onPick={pick("actorEmployeeId")}
									/>
								</div>
								<div class="audit-field audit-field--range">
									<span class="audit-field__label" aria-hidden="true">
										期間
									</span>
									<span class="audit-range">
										<input
											type="date"
											aria-label="期間の始まり"
											value={query().since}
											max={query().until || undefined}
											onChange={(event) => change({ since: event.currentTarget.value })}
										/>
										<span class="audit-range__dash" aria-hidden="true">
											〜
										</span>
										<input
											type="date"
											aria-label="期間の終わり"
											value={query().until}
											min={query().since || undefined}
											onChange={(event) => change({ until: event.currentTarget.value })}
										/>
									</span>
								</div>
							</div>
						</form>
					</search>

					<section class="audit-ledger" aria-label="記録" aria-busy={loading()}>
						<Show when={failure()}>
							<div class="audit-notice" role="alert">
								<p>{failure()}</p>
								<button type="button" class="audit-retry" onClick={() => void reload()}>
									もう一度読み込む
								</button>
							</div>
						</Show>
						<Show
							when={!loading() || entries().length > 0}
							fallback={<p class="page-note">読み込んでいます...</p>}
						>
							<Show when={!failure() && entries().length === 0}>
								<div class="audit-empty">
									<Show
										when={filtered()}
										fallback={
											<p>
												まだ記録はありません。社員マスタやシートの状態を変えると、ここに残ります。
											</p>
										}
									>
										<p>この条件に合う記録はありません。</p>
										<button type="button" class="audit-clear" onClick={clearFilters}>
											絞り込みを解除
										</button>
									</Show>
								</div>
							</Show>
							<For each={days()}>
								{(day) => (
									<section class="audit-day" aria-labelledby={`audit-day-${day.day}`}>
										<h2 class="audit-day__head" id={`audit-day-${day.day}`}>
											<time datetime={day.day}>{day.label}</time>
										</h2>
										<ol class="audit-day__entries">
											<For each={day.entries}>{(entry) => <Entry entry={entry} />}</For>
										</ol>
									</section>
								)}
							</For>
							<Show when={entries().length > 0}>
								<div class="audit-more">
									<Show when={moreFailure()}>
										<p class="field-error" role="alert">
											{moreFailure()}
										</p>
									</Show>
									<Show
										when={next() !== null}
										fallback={<p class="page-note">これより前の記録はありません。</p>}
									>
										<button
											type="button"
											class="audit-more__button"
											disabled={loadingMore()}
											onClick={() => void loadMore()}
										>
											{loadingMore() ? "読み込んでいます..." : "さらに前の記録を読み込む"}
										</button>
									</Show>
								</div>
							</Show>
						</Show>
					</section>
				</Show>
			</Show>
		</div>
	);
};

export default AuditLogView;
