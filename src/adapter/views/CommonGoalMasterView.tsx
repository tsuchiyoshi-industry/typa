import { A, useBeforeLeave } from "@solidjs/router";
import ListChecks from "lucide-solid/icons/list-checks";
import { type Component, createSignal, Index, onCleanup, onMount, Show } from "solid-js";
import {
	type CommonGoalDraft,
	type CommonGoalSet,
	GRADE_MASTER_LIMITS,
	type GradeMaster,
} from "../../domain/entities/GradeMaster";
import type { GradeMasterController } from "../controllers/GradeMasterController";
import { confirmAction, confirmDiscard, showToast, trackSaving, trackUnsaved } from "./feedback";

type Controller = Pick<
	GradeMasterController,
	"load" | "saveCommonGoalSet" | "deleteCommonGoalSet" | "makesNewVersion"
>;
interface Form {
	name: string;
	items: CommonGoalDraft[];
}
const blankItem = (): CommonGoalDraft => ({ id: null, title: "", description: "", weight: 1 });
const formOf = (set: CommonGoalSet | null): Form =>
	set
		? { name: set.name, items: set.items.map((item) => ({ ...item })) }
		: { name: "", items: [blankItem()] };
const { min, max } = GRADE_MASTER_LIMITS.weight;

/**
 * 共通目標セットの追加・変更・削除(Admin だけ)。セットは等級が選び、同じ項目で評価する等級は共有する。
 * 作成済みのシートが使うセットの項目を直すと新版になり、作成済みのシートは前の版のまま。
 */
const CommonGoalMasterView: Component<{ controller: Controller }> = (props) => {
	const [master, setMaster] = createSignal<GradeMaster | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	/** 編集しているセット。null は新しいセット。 */
	const [selectedId, setSelectedId] = createSignal<number | null>(null);
	const [form, setForm] = createSignal<Form>(formOf(null));
	const [busy, setBusy] = createSignal(false);
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});

	const shown = () => master()?.itemSets.find((set) => set.id === selectedId()) ?? null;
	const select = (id: number | null) => {
		setSelectedId(id);
		setForm(formOf(shown()));
	};
	const load = async (keep: number | null = selectedId()) => {
		setError(null);
		try {
			const loaded = await props.controller.load();
			if (!mounted) {
				return;
			}
			setMaster(loaded);
			const exists = loaded.itemSets.some((set) => set.id === keep);
			select(exists ? keep : (loaded.itemSets[0]?.id ?? null));
		} catch (cause) {
			if (mounted) {
				setMaster(null);
				setError(cause instanceof Error ? cause.message : "共通目標を読み込めませんでした。");
			}
		}
	};
	onMount(() => void load(null));

	const dirty = () => JSON.stringify(form()) !== JSON.stringify(formOf(shown()));
	trackUnsaved("common-goal-master", () => !!master() && dirty());
	trackSaving("common-goal-master", busy);
	useBeforeLeave((event) => {
		if (event.defaultPrevented || !master() || !dirty()) {
			return;
		}
		event.preventDefault();
		void confirmDiscard(true).then((discard) => discard && mounted && event.retry(true));
	});

	const users = () =>
		(master()?.grades ?? []).filter((grade) => grade.itemSetId === selectedId()).map((g) => g.name);
	const totalWeight = () =>
		form().items.reduce((sum, item) => sum + (Number.isInteger(item.weight) ? item.weight : 0), 0);
	const setItem = (index: number, patch: Partial<CommonGoalDraft>) =>
		setForm({
			...form(),
			items: form().items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
		});

	const choose = async (id: number | null, picker?: HTMLSelectElement) => {
		if (busy() || !(await confirmDiscard(dirty()))) {
			if (picker) {
				picker.value = String(selectedId() ?? "");
			}
			return;
		}
		select(id);
	};
	const run = async (task: () => Promise<void>) => {
		if (busy()) {
			return;
		}
		setBusy(true);
		try {
			await task();
		} finally {
			if (mounted) {
				setBusy(false);
			}
		}
	};

	const save = (event: Event) => {
		event.preventDefault();
		void run(async () => {
			const set = shown();
			const request = { ...form(), shown: set };
			if (set && props.controller.makesNewVersion(request)) {
				const confirmed = await confirmAction({
					title: `「${set.name}」を新しい版として保存しますか？`,
					message: `作成済みの評価シート ${set.sheetCount} 枚は今の版のままです。この共通目標を使っている等級は新しい版になり、これから作るシートから反映されます。`,
					note: "作成済みのシートに直した内容を入れたいときは、そのシートを作り直してください。",
					confirmLabel: "新しい版として保存する",
				});
				if (!confirmed) {
					return;
				}
			}
			const result = await props.controller.saveCommonGoalSet(request);
			if (!mounted) {
				return;
			}
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				await load(result.id ?? null);
			}
		});
	};

	const remove = () =>
		void run(async () => {
			const set = shown();
			const loaded = master();
			if (!set || !loaded) {
				return;
			}
			const confirmed = await confirmAction({
				title: `共通目標「${set.name}」を削除しますか？`,
				message:
					"どの等級も使っておらず、評価シートの記録にも使われていない共通目標だけを削除できます。項目もすべて消え、元に戻せません。",
				confirmLabel: "削除する",
				tone: "danger",
			});
			if (!confirmed) {
				return;
			}
			const result = await props.controller.deleteCommonGoalSet(set, loaded.grades);
			if (!mounted) {
				return;
			}
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				await load(null);
			}
		});

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<h1>
						<ListChecks class="header-icon" />
						共通目標
					</h1>
					<p>
						評価シートの共通評価に出す項目です。どの共通目標を使うかは<A href="/grades">等級</A>
						ごとに選びます。評価シートは作成時の共通目標を持ち続けるので、ここで直しても作成済みのシートは変わりません。
					</p>
				</div>
			</header>

			<Show when={error()}>
				<div class="inline-alert" role="alert">
					<span>{error()}</span>
					<button type="button" class="secondary-action" onClick={() => void load()}>
						再読み込み
					</button>
				</div>
			</Show>

			<Show
				when={master()}
				fallback={
					<Show when={!error()}>
						<p class="page-note">共通目標を読み込んでいます...</p>
					</Show>
				}
			>
				{(loaded) => (
					<>
						<div class="goal-master-toolbar">
							<label>
								編集する共通目標
								<select
									value={String(selectedId() ?? "")}
									disabled={busy() || loaded().itemSets.length === 0}
									onChange={(event) => {
										const picked = event.currentTarget.value;
										void choose(picked ? Number(picked) : null, event.currentTarget);
									}}
								>
									<Show when={selectedId() === null}>
										<option value="">(新しい共通目標)</option>
									</Show>
									<Index each={loaded().itemSets}>
										{(set) => <option value={String(set().id)}>{set().name}</option>}
									</Index>
								</select>
							</label>
							<button
								type="button"
								class="secondary-action"
								disabled={busy() || selectedId() === null}
								onClick={() => void choose(null)}
							>
								共通目標を追加
							</button>
						</div>

						<form
							class="info-card goal-master-editor"
							aria-labelledby="goal-set-heading"
							onSubmit={save}
						>
							<h2 id="goal-set-heading">{shown()?.name ?? "新しい共通目標"}</h2>
							<Show when={shown()}>
								{(set) => (
									<>
										<p>
											使っている等級:{" "}
											<Show
												when={users().length > 0}
												fallback="なし(等級の画面で選ぶと、その等級のシートに出ます)"
											>
												<strong>{users().join("・")}</strong>
											</Show>
										</p>
										<Show when={set().sheetCount > 0}>
											<p class="allocation-note">
												この共通目標で作成済みの評価シート {set().sheetCount}{" "}
												枚があります。項目を直して保存すると新しい版になり、作成済みのシートは前の版のままです。
											</p>
										</Show>
									</>
								)}
							</Show>

							<label class="goal-master-name">
								名前
								<input
									type="text"
									required
									maxLength={GRADE_MASTER_LIMITS.name}
									placeholder="例: 一般"
									value={form().name}
									disabled={busy()}
									onInput={(event) => setForm({ ...form(), name: event.currentTarget.value })}
								/>
							</label>

							<ol class="goal-master-items">
								<Index each={form().items}>
									{(item, index) => (
										<li>
											<span class="goal-master-row" aria-hidden="true">
												{index + 1}
											</span>
											<input
												type="text"
												required
												maxLength={GRADE_MASTER_LIMITS.title}
												aria-label={`${index + 1} 行目の項目名`}
												placeholder="項目名"
												value={item().title}
												disabled={busy()}
												onInput={(event) => setItem(index, { title: event.currentTarget.value })}
											/>
											<textarea
												aria-label={`${index + 1} 行目の説明`}
												placeholder="説明"
												maxLength={GRADE_MASTER_LIMITS.description}
												rows={2}
												value={item().description}
												disabled={busy()}
												onInput={(event) =>
													setItem(index, { description: event.currentTarget.value })
												}
											/>
											<label class="goal-master-weight">
												重み
												<input
													type="number"
													required
													min={min}
													max={max}
													step={1}
													aria-label={`${index + 1} 行目の重み`}
													value={Number.isNaN(item().weight) ? "" : String(item().weight)}
													disabled={busy()}
													onInput={(event) => {
														const value = event.currentTarget.value;
														setItem(index, { weight: value === "" ? Number.NaN : Number(value) });
													}}
												/>
											</label>
											<button
												type="button"
												class="secondary-action"
												aria-label={`${index + 1} 行目を削除`}
												disabled={busy() || form().items.length <= 1}
												onClick={() =>
													setForm({ ...form(), items: form().items.filter((_, i) => i !== index) })
												}
											>
												削除
											</button>
										</li>
									)}
								</Index>
							</ol>
							<div class="goal-master-footer">
								<button
									type="button"
									class="secondary-action"
									disabled={busy() || form().items.length >= GRADE_MASTER_LIMITS.items}
									onClick={() => setForm({ ...form(), items: [...form().items, blankItem()] })}
								>
									項目を追加
								</button>
								<span class="allocation-note">
									{form().items.length} 項目・重みの合計 {totalWeight()}
								</span>
							</div>
							<p class="allocation-note">
								共通評価の点は、項目ごとの評価点(1〜4)に重みを掛けて合計し、配点に換算します。重みは{" "}
								{min}〜{max} の整数です。
							</p>

							<div class="settings-actions">
								<Show when={shown()}>
									<button type="button" class="secondary-action" disabled={busy()} onClick={remove}>
										この共通目標を削除
									</button>
								</Show>
								<button
									type="button"
									class="secondary-action"
									disabled={busy() || !dirty()}
									onClick={() => setForm(formOf(shown()))}
								>
									元に戻す
								</button>
								<button type="submit" class="primary-action" disabled={busy()}>
									保存する
								</button>
							</div>
						</form>
					</>
				)}
			</Show>
		</div>
	);
};

export default CommonGoalMasterView;
