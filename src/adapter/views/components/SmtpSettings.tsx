import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { NOTIFICATION_TEMPLATES } from "../../../../supabase/functions/_shared/notificationTemplates";
import type { SmtpSettingsSummary } from "../../../domain/repositories/WorkspaceSettingsRepository";
import type { SmtpSettingsController } from "../../controllers/SmtpSettingsController";
import { showToast } from "../feedback";

interface SmtpSettingsProps {
	controller: Pick<SmtpSettingsController, "load" | "save" | "sendTest">;
}

/** Admin が、通知メールを送る SMTP サーバーと送信元アドレスを決める。 */
const SmtpSettings: Component<SmtpSettingsProps> = (props) => {
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);
	const [sending, setSending] = createSignal(false);
	const busy = () => saving() || sending();
	const [passwordSet, setPasswordSet] = createSignal(false);
	const [form, setForm] = createSignal({ host: "", port: "465", user: "", password: "" });
	const [saved, setSaved] = createSignal<SmtpSettingsSummary | null>(null);
	const [testTo, setTestTo] = createSignal("");
	const [templateId, setTemplateId] = createSignal<string>(NOTIFICATION_TEMPLATES[0].id);
	const hasSavedSettings = () => !!saved()?.host && !!saved()?.user;
	const dirty = () =>
		form().host.trim() !== (saved()?.host ?? "") ||
		Number(form().port) !== (saved()?.port ?? 465) ||
		form().user.trim() !== (saved()?.user ?? "") ||
		form().password !== "";
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});

	const load = async () => {
		setError(null);
		try {
			const settings = await props.controller.load();
			if (mounted) {
				setSaved(settings);
			}
			if (mounted && settings) {
				setPasswordSet(settings.passwordSet);
				setForm({
					host: settings.host,
					port: String(settings.port),
					user: settings.user,
					password: "",
				});
			}
		} catch {
			if (mounted) {
				setError("通知メールの設定を読み込めませんでした。");
			}
		} finally {
			if (mounted) {
				setLoading(false);
			}
		}
	};
	onMount(() => void load());

	const save = async (event: Event) => {
		event.preventDefault();
		if (busy()) {
			return;
		}
		setSaving(true);
		try {
			const result = await props.controller.save({ ...form(), port: Number(form().port) });
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				await load();
			}
		} finally {
			if (mounted) {
				setSaving(false);
			}
		}
	};

	const sendTest = async (event: Event) => {
		event.preventDefault();
		if (busy() || !hasSavedSettings() || dirty()) {
			return;
		}
		setSending(true);
		try {
			const result = await props.controller.sendTest({ to: testTo(), templateId: templateId() });
			if (mounted) {
				showToast(result.success ? "success" : "error", result.message);
			}
		} catch {
			if (mounted) {
				showToast("error", "テストメールを送信できませんでした。時間をおいて再度お試しください。");
			}
		} finally {
			if (mounted) {
				setSending(false);
			}
		}
	};

	return (
		<section class="info-card" aria-labelledby="smtp-heading">
			<h2 id="smtp-heading">通知メール</h2>
			<p>
				提出時に一次評価者へ、一次評価の確定時に二次評価者へ通知します。SMTPサーバーと送信元メールアドレスを設定します。
				送信ポートは465（TLS）を指定してください。25と587は使用できません。
			</p>
			<p class="allocation-note">
				保存したパスワードは、この画面には表示されません。変更するときだけ入力してください。
			</p>

			<Show when={error()}>
				<div class="inline-alert" role="alert">
					<span>{error()}</span>
					<button type="button" class="secondary-action" onClick={() => void load()}>
						再読み込み
					</button>
				</div>
			</Show>

			<Show
				when={!loading()}
				fallback={<p class="page-note">通知メールの設定を読み込んでいます...</p>}
			>
				<form class="allocation-form period-form" onSubmit={(event) => void save(event)}>
					<label>
						SMTP ホスト
						<input
							type="text"
							required
							placeholder="smtp.example.jp"
							value={form().host}
							disabled={busy()}
							onInput={(event) => setForm({ ...form(), host: event.currentTarget.value })}
						/>
					</label>
					<label>
						ポート
						<input
							type="number"
							required
							min="1"
							max="65535"
							step="1"
							value={form().port}
							disabled={busy()}
							onInput={(event) => setForm({ ...form(), port: event.currentTarget.value })}
						/>
					</label>
					<label>
						送信元メールアドレス
						<input
							type="email"
							required
							autocomplete="off"
							value={form().user}
							disabled={busy()}
							onInput={(event) => setForm({ ...form(), user: event.currentTarget.value })}
						/>
					</label>
					<label>
						パスワード
						<input
							type="password"
							required={!passwordSet()}
							autocomplete="new-password"
							placeholder={passwordSet() ? "登録済み（変更しない場合は空欄）" : undefined}
							value={form().password}
							disabled={busy()}
							onInput={(event) => setForm({ ...form(), password: event.currentTarget.value })}
						/>
					</label>
					<button type="submit" class="primary-action" disabled={busy()}>
						{saving() ? "保存中..." : "通知メールの設定を保存する"}
					</button>
				</form>
				<h3>送信テスト</h3>
				<p class="allocation-note">
					保存済みの設定で、選択した通知をサンプルの社員・評価期間で送信します。入力した宛先は保存されません。
				</p>
				<Show when={dirty() || !hasSavedSettings()}>
					<p class="field-hint">通知メールの設定を保存してから送信してください。</p>
				</Show>
				<form
					class="allocation-form period-form smtp-test-form"
					onSubmit={(event) => void sendTest(event)}
				>
					<label>
						宛先メールアドレス
						<input
							type="email"
							required
							autocomplete="off"
							value={testTo()}
							disabled={busy()}
							onInput={(event) => setTestTo(event.currentTarget.value)}
						/>
					</label>
					<label>
						通知パターン
						<select
							required
							value={templateId()}
							disabled={busy()}
							onChange={(event) => setTemplateId(event.currentTarget.value)}
						>
							<For each={NOTIFICATION_TEMPLATES}>
								{(template) => <option value={template.id}>{template.label}</option>}
							</For>
						</select>
					</label>
					<button
						type="submit"
						class="primary-action"
						disabled={busy() || !hasSavedSettings() || dirty()}
					>
						{sending() ? "送信中..." : "テストメールを送信する"}
					</button>
				</form>
			</Show>
		</section>
	);
};

export default SmtpSettings;
