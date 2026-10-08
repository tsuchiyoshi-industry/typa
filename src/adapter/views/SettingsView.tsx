import { useBeforeLeave } from "@solidjs/router";
import Settings from "lucide-solid/icons/settings";
import { type Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import type { EvaluationPeriodController } from "../controllers/EvaluationPeriodController";
import {
	MAX_CHALLENGE_GOALS_RANGE,
	type SettingsController,
} from "../controllers/SettingsController";
import type { SmtpSettingsController } from "../controllers/SmtpSettingsController";
import EvaluationPeriodSettings from "./components/EvaluationPeriodSettings";
import SmtpSettings from "./components/SmtpSettings";
import { confirmAction, confirmDiscard, showToast, trackUnsaved } from "./feedback";

interface SettingsViewProps {
	controller: SettingsController;
	periodController: Pick<EvaluationPeriodController, "load" | "save" | "remove" | "close">;
	smtpController: Pick<SmtpSettingsController, "load" | "save">;
}

const TOTAL = EvaluationAllocation.TOTAL;
const isAllocation = (value: number) => Number.isInteger(value) && value >= 0 && value <= TOTAL;

/** Admin が、会社ごとの評価の基準を決める。 */
const SettingsView: Component<SettingsViewProps> = (props) => {
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [canEdit, setCanEdit] = createSignal(false);
	const [saved, setSaved] = createSignal({ objective: 0, common: 0 });
	const [objective, setObjective] = createSignal(0);
	const [common, setCommon] = createSignal(0);
	const [savedMaxGoals, setSavedMaxGoals] = createSignal(0);
	const [maxGoals, setMaxGoals] = createSignal(0);
	const [saving, setSaving] = createSignal(false);
	const [confirming, setConfirming] = createSignal(false);
	const busy = () => saving() || confirming();
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});

	const load = async () => {
		setLoading(true);
		setError(null);
		setCanEdit(false);
		try {
			const settings = await props.controller.load();
			if (!mounted) {
				return;
			}
			setCanEdit(settings.canEdit);
			setSaved({ objective: settings.objective, common: settings.common });
			setObjective(settings.objective);
			setCommon(settings.common);
			setSavedMaxGoals(settings.maxChallengeGoals);
			setMaxGoals(settings.maxChallengeGoals);
		} catch {
			if (mounted) {
				setError("設定を読み込めませんでした。再読み込みしてください。");
			}
		} finally {
			if (mounted) {
				setLoading(false);
			}
		}
	};
	onMount(() => void load());

	const valid = () =>
		isAllocation(objective()) && isAllocation(common()) && objective() + common() === TOTAL;
	const dirty = () => objective() !== saved().objective || common() !== saved().common;
	trackUnsaved("evaluation-settings", () => canEdit() && dirty());
	useBeforeLeave((event) => {
		if (event.defaultPrevented) {
			return;
		}
		if (busy()) {
			event.preventDefault();
			showToast("info", "配点の変更が完了するまでお待ちください");
			return;
		}
		if (!canEdit() || !dirty()) {
			return;
		}
		event.preventDefault();
		void confirmDiscard(true).then((discard) => {
			if (discard && mounted) {
				event.retry(true);
			}
		});
	});

	// 合計は常に 100 点。片方を変えたら、もう片方を残りの点数にする
	const pick = (value: string, set: (v: number) => void, setOther: (v: number) => void) => {
		const picked = value === "" ? Number.NaN : Number(value);
		set(picked);
		if (isAllocation(picked)) {
			setOther(TOTAL - picked);
		}
	};

	const save = async () => {
		if (!canEdit() || !valid() || !dirty() || busy()) {
			return;
		}
		const next = { objective: objective(), common: common() };
		setConfirming(true);
		try {
			const confirmed = await confirmAction({
				title: `配点をチャレンジ目標 ${next.objective} 点・共通評価 ${next.common} 点に変更しますか？`,
				message:
					"未確定の評価シートの評価点と見込みランクに反映されます。確定済みの評価シートと、確定した一次評価ランクは保持されます。",
				confirmLabel: "配点を変更する",
			});
			if (!confirmed || !mounted) {
				return;
			}
			setSaving(true);
			setConfirming(false);
			const result = await props.controller.saveAllocation(next.objective, next.common);
			if (!mounted) {
				return;
			}
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				setSaved(next);
			}
		} finally {
			if (mounted) {
				setSaving(false);
				setConfirming(false);
			}
		}
	};

	const saveMaxGoals = async (event: Event) => {
		event.preventDefault();
		if (busy()) {
			return;
		}
		setSaving(true);
		try {
			const next = maxGoals();
			const result = await props.controller.saveMaxChallengeGoals(next);
			if (!mounted) {
				return;
			}
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				setSavedMaxGoals(next);
			}
		} finally {
			if (mounted) {
				setSaving(false);
			}
		}
	};

	const example = (rate: number, allocation: number) =>
		isAllocation(allocation) ? EvaluationAllocation.toScore(allocation, rate) : "—";

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<h1>
						<Settings class="header-icon" />
						設定
					</h1>
					<p>
						評価期間、評価の計算に使う会社ごとの基準、通知メールの送信元です。Admin
						だけが変更できます。
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

			<Show when={!loading()} fallback={<p class="page-note">設定を読み込んでいます...</p>}>
				<Show
					when={canEdit()}
					fallback={
						<Show when={!error()}>
							<p class="page-note">設定は Admin のみ利用できます。</p>
						</Show>
					}
				>
					<EvaluationPeriodSettings controller={props.periodController} />
					<section class="info-card" aria-labelledby="allocation-heading">
						<h2 id="allocation-heading">評価点の配点</h2>
						<p>
							評価点は {TOTAL}{" "}
							点満点です。そのうち何点をチャレンジ目標に、何点を共通評価に割り振るかを
							決めます。片方を変えると、もう片方は残りの点数になります。
						</p>
						<p class="allocation-note">配点の割合 1％ は、100 点満点のうち 1 点に相当します。</p>
						<p class="allocation-saved">
							登録済み: チャレンジ目標 {saved().objective}％ ／ 共通評価 {saved().common}％
							<Show when={dirty()}>
								<span class="allocation-dirty">未保存</span>
							</Show>
						</p>
						<Show when={valid()}>
							<div
								class="allocation-preview"
								role="img"
								aria-label={`チャレンジ目標 ${objective()}％、共通評価 ${common()}％`}
							>
								<span class="allocation-preview-objective" style={{ width: `${objective()}%` }} />
								<span class="allocation-preview-common" style={{ width: `${common()}%` }} />
							</div>
						</Show>
						<div class="allocation-form">
							<label>
								<span id="objective-allocation-label">チャレンジ目標</span>
								<span class="allocation-input">
									<input
										aria-labelledby="objective-allocation-label"
										type="number"
										min="0"
										max={TOTAL}
										step="1"
										value={Number.isNaN(objective()) ? "" : objective()}
										disabled={busy()}
										onInput={(event) => pick(event.currentTarget.value, setObjective, setCommon)}
									/>
									点
								</span>
							</label>
							<span class="allocation-plus" aria-hidden="true">
								＋
							</span>
							<label>
								<span id="common-allocation-label">共通評価</span>
								<span class="allocation-input">
									<input
										aria-labelledby="common-allocation-label"
										type="number"
										min="0"
										max={TOTAL}
										step="1"
										value={Number.isNaN(common()) ? "" : common()}
										disabled={busy()}
										onInput={(event) => pick(event.currentTarget.value, setCommon, setObjective)}
									/>
									点
								</span>
							</label>
							<span class="allocation-total" classList={{ invalid: !valid() }}>
								＝ {TOTAL} 点
							</span>
						</div>
						<Show when={!valid()}>
							<p class="field-error" role="alert">
								0〜{TOTAL} の整数で、合計が {TOTAL} 点になるように入力してください。
							</p>
						</Show>

						<h3>計算のしかた</h3>
						<dl class="allocation-rules">
							<div>
								<dt>チャレンジ目標</dt>
								<dd>
									目標の点数の合計 ÷（目標の数 × 4 点）× 配点。目標が 2 つなら、2 つの点数を足して 8
									で割ります。
									<small>
										例: どちらも 4 点 → {example(100, objective())} 点 ／ 3 点と 4 点 →{" "}
										{example(87.5, objective())} 点 ／ どちらも 2 点 → {example(50, objective())} 点
									</small>
								</dd>
							</div>
							<div>
								<dt>共通評価</dt>
								<dd>
									項目ごとに 1〜4 で評価し、「項目の配点 × 評価」を合計します。その合計 ÷
									満点（項目の配点の合計 × 4）× 共通評価の配点。項目の配点が 1 の項目が 10
									個なら、満点は 40
									点です。等級によって項目の数が違っても、満点は共通評価の配点になります。
									<small>
										例: 得点率 100% → {example(100, common())} 点 ／ 75% → {example(75, common())}{" "}
										点 ／ 50% → {example(50, common())} 点
									</small>
								</dd>
							</div>
						</dl>
						<p class="allocation-note">
							得点率は途中で丸めず、配点を掛けた後にそれぞれ 1
							点単位に四捨五入します。評価ランクは、2 つを足した評価点の得点率で決まります。
						</p>

						<div class="settings-actions">
							<button
								type="button"
								class="secondary-action"
								disabled={!dirty() || busy()}
								onClick={() => {
									setObjective(saved().objective);
									setCommon(saved().common);
								}}
							>
								元に戻す
							</button>
							<button
								type="button"
								class="primary-action"
								disabled={!dirty() || !valid() || busy()}
								onClick={() => void save()}
							>
								{saving() ? "保存中..." : confirming() ? "確認中..." : "配点を保存する"}
							</button>
						</div>
					</section>
					<section class="info-card" aria-labelledby="max-goals-heading">
						<h2 id="max-goals-heading">チャレンジ目標の数</h2>
						<p>
							1枚の評価シートに置ける目標の数の上限です。目標は最低 1
							件必要で、上限を超えるシートは提出・確定できません。
						</p>
						<p class="allocation-note">
							チャレンジ目標の得点率は「点数の合計 ÷（そのシートの目標の数 ×
							4）」で、上限を変えても変わりません。上限を下げると、それより多い目標を持つ未確定のシートは、目標を減らすまで提出・確定できなくなります。
						</p>
						<form class="allocation-form" onSubmit={(event) => void saveMaxGoals(event)}>
							<label>
								<span id="max-goals-label">上限</span>
								<span class="allocation-input">
									<input
										aria-labelledby="max-goals-label"
										type="number"
										required
										min={MAX_CHALLENGE_GOALS_RANGE.min}
										max={MAX_CHALLENGE_GOALS_RANGE.max}
										step="1"
										value={Number.isNaN(maxGoals()) ? "" : maxGoals()}
										disabled={busy()}
										onInput={(event) =>
											setMaxGoals(
												event.currentTarget.value === ""
													? Number.NaN
													: Number(event.currentTarget.value),
											)
										}
									/>
									件
								</span>
							</label>
							<button
								type="submit"
								class="primary-action"
								disabled={busy() || maxGoals() === savedMaxGoals()}
							>
								上限を保存する
							</button>
						</form>
					</section>
					<SmtpSettings controller={props.smtpController} />
				</Show>
			</Show>
		</div>
	);
};

export default SettingsView;
