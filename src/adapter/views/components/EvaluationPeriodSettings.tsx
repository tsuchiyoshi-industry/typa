import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { EvaluationPeriodDto } from "../../../application/dtos/EvaluationPeriodDto";
import type { EvaluationPeriodController } from "../../controllers/EvaluationPeriodController";
import { confirmAction, showToast } from "../feedback";

interface EvaluationPeriodSettingsProps {
	controller: Pick<EvaluationPeriodController, "load" | "save" | "remove" | "close">;
}

const EMPTY_FORM = { periodName: "", startDate: "", endDate: "" };

/** 期間締めの前に、Admin に確かめてもらうこと。 */
const closingNotes = (closing: string | null, next: string, finalizedSheets: number): string[] => [
	...(closing
		? [
				`「${closing}」の評価シートは ${finalizedSheets} 件で、すべて最終評価済みです。未確定のシートはありません。`,
				`締めた後は、「${closing}」の評価シートを誰も変更できません。閲覧と PDF 出力は引き続きできます。`,
				`「${closing}」のシートをまだ作成していない社員がいても、締めた後は作成できません。作成漏れがないか、先に確認してください。`,
			]
		: []),
	`評価シートの作成・記入・評価・確定ができるのは「${next}」だけになります。「${next}」のシートは自動では作られず、各社員が「新規作成」から作成します。`,
	`シートの等級は作成時のもので固定されます。昇級などの等級の変更は、社員が「${next}」のシートを作成する前に、社員マスタで済ませてください。`,
	`評価者（一次・二次）の付け替えは、未確定のシートにだけ反映されます。確定済みのシートは、評価した人のまま変わりません。「${next}」の評価者は、評価が始まる前に社員マスタで見直してください。`,
	"評価点の配点は期間ごとではなく共通の設定です。確定済みのシートは、確定時の配点のまま変わりません。",
	"利用中の社員の画面には、画面を開き直したときに反映されます。",
	...(closing
		? [
				`間違えた場合は、「${closing}」をもう一度開始すれば元に戻せます。ただし、その時点で「${next}」に未確定のシートがあると戻せません。`,
			]
		: []),
];

/** Admin が評価期間を追加・変更・削除し、期間を締めて次の期間を始める。 */
const EvaluationPeriodSettings: Component<EvaluationPeriodSettingsProps> = (props) => {
	const [periods, setPeriods] = createSignal<EvaluationPeriodDto[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [editingId, setEditingId] = createSignal<number | null>(null);
	const [form, setForm] = createSignal(EMPTY_FORM);
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});

	const load = async () => {
		setError(null);
		try {
			const loaded = await props.controller.load();
			if (mounted) {
				setPeriods(loaded);
			}
		} catch {
			if (mounted) {
				setError("評価期間を読み込めませんでした。");
			}
		} finally {
			if (mounted) {
				setLoading(false);
			}
		}
	};
	onMount(() => void load());

	/** 操作の間はボタンを止め、終わったら一覧を取り直す。 */
	const run = async (operation: () => Promise<void>) => {
		if (busy()) {
			return;
		}
		setBusy(true);
		try {
			await operation();
			await load();
		} finally {
			if (mounted) {
				setBusy(false);
			}
		}
	};

	const resetForm = () => {
		setEditingId(null);
		setForm(EMPTY_FORM);
	};
	const edit = (period: EvaluationPeriodDto) => {
		setEditingId(period.id);
		setForm({
			periodName: period.periodName,
			startDate: period.startDate,
			endDate: period.endDate,
		});
	};

	const save = (event: Event) => {
		event.preventDefault();
		void run(async () => {
			const result = await props.controller.save({
				...form(),
				...(editingId() === null ? {} : { periodId: editingId() as number }),
			});
			showToast(result.success ? "success" : "error", result.message);
			if (result.success && mounted) {
				resetForm();
			}
		});
	};

	const remove = (period: EvaluationPeriodDto) =>
		run(async () => {
			const confirmed = await confirmAction({
				title: `評価期間「${period.periodName}」を削除しますか？`,
				message: "評価シートが1件もない期間だけを削除できます。削除した期間は元に戻せません。",
				confirmLabel: "削除する",
				tone: "danger",
			});
			if (!confirmed) {
				return;
			}
			const result = await props.controller.remove(period.id);
			showToast(result.success ? "success" : "error", result.message);
		});

	const close = (next: EvaluationPeriodDto) =>
		run(async () => {
			// 未確定のシートが残っていないかを先に確かめる。残っていれば、確認には進まない
			const preview = await props.controller.close(next.id, false);
			if (preview.status !== "ready") {
				showToast("error", "評価期間を切り替えられません", preview.message);
				return;
			}
			const closing = preview.closing?.periodName ?? null;
			const confirmed = await confirmAction({
				title: closing
					? `「${closing}」を締めて、「${next.periodName}」を開始しますか？`
					: `「${next.periodName}」を開始しますか？`,
				message: "実施中の評価期間は常に1つです。次の点を確認してください。",
				details: closingNotes(closing, next.periodName, preview.finalizedSheets),
				confirmLabel: closing ? "締めて、次の期間を開始する" : "この期間を開始する",
				tone: "danger",
			});
			if (!confirmed) {
				return;
			}
			const result = await props.controller.close(next.id, true);
			if (result.status === "closed") {
				showToast("success", result.message);
			} else {
				showToast(
					"error",
					"評価期間を切り替えられませんでした",
					result.status === "rejected" ? result.message : undefined,
				);
			}
		});

	return (
		<section class="info-card" aria-labelledby="period-heading">
			<h2 id="period-heading">評価期間</h2>
			<p>
				実施中の評価期間は常に 1
				つです。評価シートの作成・記入・評価・確定ができるのは実施中の期間だけで、締めた期間のシートは閲覧と
				PDF 出力だけになります。
			</p>
			<p class="allocation-note">
				次の期間を開始すると、実施中の期間は同時に締められます。未確定の評価シートが残っている間は締められません。
			</p>

			<Show when={error()}>
				<div class="inline-alert" role="alert">
					<span>{error()}</span>
					<button type="button" class="secondary-action" onClick={() => void load()}>
						再読み込み
					</button>
				</div>
			</Show>

			<Show when={!loading()} fallback={<p class="page-note">評価期間を読み込んでいます...</p>}>
				<Show
					when={periods().length > 0}
					fallback={
						<Show when={!error()}>
							<p class="page-note">評価期間はまだありません。下のフォームから追加してください。</p>
						</Show>
					}
				>
					<div class="table-scroll">
						<table class="sheet-table period-table">
							<thead>
								<tr>
									<th>期間名</th>
									<th>開始日</th>
									<th>終了日</th>
									<th>状態</th>
									<th>
										<span class="visually-hidden">操作</span>
									</th>
								</tr>
							</thead>
							<tbody>
								<For each={periods()}>
									{(period) => (
										<tr>
											<td>{period.periodName}</td>
											<td>{period.startDate}</td>
											<td>{period.endDate}</td>
											<td>
												<Show when={period.isActive} fallback="—">
													<span class="period-badge">実施中</span>
												</Show>
											</td>
											<td>
												<div class="period-actions">
													<Show when={!period.isActive}>
														<button
															type="button"
															class="secondary-action"
															disabled={busy()}
															aria-label={`${period.periodName}を開始する`}
															onClick={() => void close(period)}
														>
															この期間を開始する
														</button>
													</Show>
													<button
														type="button"
														class="secondary-action"
														disabled={busy()}
														aria-label={`${period.periodName}を編集`}
														onClick={() => edit(period)}
													>
														編集
													</button>
													<Show when={!period.isActive}>
														<button
															type="button"
															class="secondary-action"
															disabled={busy()}
															aria-label={`${period.periodName}を削除`}
															onClick={() => void remove(period)}
														>
															削除
														</button>
													</Show>
												</div>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</Show>
			</Show>

			<h3>{editingId() === null ? "評価期間を追加" : "評価期間を変更"}</h3>
			<form class="allocation-form period-form" onSubmit={save}>
				<label>
					期間名
					<input
						type="text"
						required
						value={form().periodName}
						disabled={busy()}
						onInput={(event) => setForm({ ...form(), periodName: event.currentTarget.value })}
					/>
				</label>
				<label>
					開始日
					<input
						type="date"
						required
						value={form().startDate}
						disabled={busy()}
						onInput={(event) => setForm({ ...form(), startDate: event.currentTarget.value })}
					/>
				</label>
				<label>
					終了日
					<input
						type="date"
						required
						value={form().endDate}
						min={form().startDate}
						disabled={busy()}
						onInput={(event) => setForm({ ...form(), endDate: event.currentTarget.value })}
					/>
				</label>
				<Show when={editingId() !== null}>
					<button type="button" class="secondary-action" disabled={busy()} onClick={resetForm}>
						キャンセル
					</button>
				</Show>
				<button type="submit" class="primary-action" disabled={busy()}>
					{editingId() === null ? "追加する" : "変更を保存する"}
				</button>
			</form>
		</section>
	);
};

export default EvaluationPeriodSettings;
