import { A, useBeforeLeave } from "@solidjs/router";
import Layers from "lucide-solid/icons/layers";
import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { GradeEntry, GradeMaster } from "../../domain/entities/GradeMaster";
import type { GradeMasterController } from "../controllers/GradeMasterController";
import { confirmAction, confirmDiscard, showToast, trackSaving, trackUnsaved } from "./feedback";

type Controller = Pick<GradeMasterController, "load" | "saveGrade" | "deleteGrade">;
const emptyForm = { name: "", itemSetId: null as number | null };

/** 等級の一覧と、追加・変更・削除(Admin だけ)。等級ごとに、評価シートに出す共通目標を選ぶ。 */
const GradeMasterView: Component<{ controller: Controller }> = (props) => {
	const [master, setMaster] = createSignal<GradeMaster | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [editing, setEditing] = createSignal<GradeEntry | null>(null);
	const [form, setForm] = createSignal(emptyForm);
	const [busy, setBusy] = createSignal(false);
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});

	const load = async () => {
		setError(null);
		try {
			const loaded = await props.controller.load();
			if (mounted) {
				setMaster(loaded);
			}
		} catch (cause) {
			if (mounted) {
				setMaster(null);
				setError(cause instanceof Error ? cause.message : "等級を読み込めませんでした。");
			}
		}
	};
	onMount(() => void load());

	const initial = () => {
		const shown = editing();
		return shown ? { name: shown.name, itemSetId: shown.itemSetId } : emptyForm;
	};
	const dirty = () => form().name !== initial().name || form().itemSetId !== initial().itemSetId;
	trackUnsaved("grade-master", dirty);
	trackSaving("grade-master", busy);
	useBeforeLeave((event) => {
		if (event.defaultPrevented || !dirty()) {
			return;
		}
		event.preventDefault();
		void confirmDiscard(true).then((discard) => discard && mounted && event.retry(true));
	});

	const setName = (grade: GradeEntry) =>
		master()?.itemSets.find((set) => set.id === grade.itemSetId)?.name ?? "なし";

	const reset = () => {
		setEditing(null);
		setForm(emptyForm);
	};
	const edit = async (grade: GradeEntry) => {
		if (busy() || !(await confirmDiscard(dirty()))) {
			return;
		}
		setEditing(grade);
		setForm({ name: grade.name, itemSetId: grade.itemSetId });
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
			const shown = editing();
			const next = form();
			if (shown && shown.sheetCount > 0 && shown.itemSetId !== next.itemSetId) {
				const confirmed = await confirmAction({
					title: `「${shown.name}」の共通目標を変えますか？`,
					message: `この等級で作成済みの評価シート ${shown.sheetCount} 枚は、作成時の共通目標のままです。これから作るシートから、選んだ共通目標になります。`,
					note: "作成済みのシートに新しい共通目標を入れたいときは、そのシートを作り直してください。",
					confirmLabel: "共通目標を変える",
				});
				if (!confirmed) {
					return;
				}
			}
			const result = await props.controller.saveGrade({ ...next, shown });
			if (!mounted) {
				return;
			}
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				reset();
				await load();
			}
		});
	};

	const remove = (grade: GradeEntry) =>
		void run(async () => {
			const confirmed = await confirmAction({
				title: `等級「${grade.name}」を削除しますか？`,
				message: "社員がいない等級で、評価シートの記録にも使われていないものだけを削除できます。",
				confirmLabel: "削除する",
				tone: "danger",
			});
			if (!confirmed) {
				return;
			}
			const result = await props.controller.deleteGrade(grade);
			if (!mounted) {
				return;
			}
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				if (editing()?.id === grade.id) {
					reset();
				}
				await load();
			}
		});

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<h1>
						<Layers class="header-icon" />
						等級
					</h1>
					<p>
						等級ごとに、評価シートに出す<A href="/common-goals">共通目標</A>
						を選びます。評価シートは作成時の等級の共通目標を持ち続けるので、ここで変えても作成済みのシートは変わりません。
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
						<p class="page-note">等級を読み込んでいます...</p>
					</Show>
				}
			>
				{(loaded) => (
					<section class="info-card" aria-labelledby="grade-list-heading">
						<h2 id="grade-list-heading">等級の一覧</h2>
						<Show
							when={loaded().grades.length > 0}
							fallback={
								<p class="page-note">等級はまだありません。下のフォームから追加してください。</p>
							}
						>
							<div class="table-scroll">
								<table class="sheet-table grade-master-table">
									<thead>
										<tr>
											<th>等級</th>
											<th>共通目標</th>
											<th class="numeric">社員</th>
											<th class="numeric">作成済みのシート</th>
											<th>
												<span class="visually-hidden">操作</span>
											</th>
										</tr>
									</thead>
									<tbody>
										<For each={loaded().grades}>
											{(grade) => (
												<tr>
													<td>{grade.name}</td>
													<td>{setName(grade)}</td>
													<td class="numeric">{grade.employeeCount} 人</td>
													<td class="numeric">{grade.sheetCount} 枚</td>
													<td>
														<div class="period-actions">
															<button
																type="button"
																class="secondary-action"
																disabled={busy()}
																aria-label={`${grade.name}を編集`}
																onClick={() => void edit(grade)}
															>
																編集
															</button>
															<button
																type="button"
																class="secondary-action"
																disabled={busy()}
																aria-label={`${grade.name}を削除`}
																onClick={() => remove(grade)}
															>
																削除
															</button>
														</div>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</Show>

						<h3>{editing() ? `「${editing()?.name}」を変更` : "等級を追加"}</h3>
						<form class="allocation-form period-form" onSubmit={save}>
							<label>
								等級名
								<input
									type="text"
									required
									maxLength={50}
									placeholder="例: 総合Ⅰ級"
									value={form().name}
									disabled={busy()}
									onInput={(event) => setForm({ ...form(), name: event.currentTarget.value })}
								/>
							</label>
							<label>
								共通目標
								<select
									class="grade-master-select"
									required
									value={String(form().itemSetId ?? "")}
									disabled={busy()}
									onChange={(event) =>
										setForm({
											...form(),
											itemSetId: event.currentTarget.value
												? Number(event.currentTarget.value)
												: null,
										})
									}
								>
									<option value="">選んでください</option>
									<For each={loaded().itemSets}>
										{(set) => <option value={String(set.id)}>{set.name}</option>}
									</For>
								</select>
							</label>
							<Show when={editing()}>
								<button type="button" class="secondary-action" disabled={busy()} onClick={reset}>
									キャンセル
								</button>
							</Show>
							<button type="submit" class="primary-action" disabled={busy()}>
								{editing() ? "変更を保存する" : "追加する"}
							</button>
						</form>
						<p class="allocation-note">
							社員の等級は社員マスタで変えます。社員がいる等級と、評価シートの記録に使われている等級は削除できません。
						</p>
					</section>
				)}
			</Show>
		</div>
	);
};

export default GradeMasterView;
