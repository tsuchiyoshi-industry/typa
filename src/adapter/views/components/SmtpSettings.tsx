import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { NOTIFICATION_TEMPLATES } from "../../../../supabase/functions/_shared/notificationTemplates";
import type { NotificationChannel } from "../../../domain/repositories/WorkspaceSettingsRepository";
import type { SmtpSettingsController } from "../../controllers/SmtpSettingsController";
import { showToast } from "../feedback";
import { formatDateTime } from "../format";

interface SmtpSettingsProps {
	controller: Pick<SmtpSettingsController, "load" | "save" | "chooseChannel">;
}

/** Admin が、通知メールを送る SMTP サーバーと送信元アドレスを決める。 */
const SmtpSettings: Component<SmtpSettingsProps> = (props) => {
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);
	const [passwordSet, setPasswordSet] = createSignal(false);
	const [channel, setChannel] = createSignal<NotificationChannel>("in_app");
	const [verifiedAt, setVerifiedAt] = createSignal<string | null>(null);
	const [choosing, setChoosing] = createSignal(false);
	const [form, setForm] = createSignal({ host: "", port: "465", user: "", password: "" });
	const [testTo, setTestTo] = createSignal("");
	const [templateId, setTemplateId] = createSignal<string>(NOTIFICATION_TEMPLATES[0].id);
	let mounted = true;
	onCleanup(() => {
		mounted = false;
	});

	const load = async () => {
		setError(null);
		try {
			const settings = await props.controller.load();
			if (mounted && settings) {
				setPasswordSet(settings.passwordSet);
				setChannel(settings.channel);
				setVerifiedAt(settings.verifiedAt);
				setForm({
					host: settings.host,
					// まだ設定がなければ、使える 465 から始める(DB の初期値 587 は Edge Function から使えない)
					port: settings.host ? String(settings.port) : "465",
					user: settings.user,
					password: "",
				});
			}
		} catch {
			if (mounted) {
				setError("通知の設定を読み込めませんでした。");
			}
		} finally {
			if (mounted) {
				setLoading(false);
			}
		}
	};
	onMount(() => void load());

	// 選んだらすぐ保存する。保存できなければ、保存済みの方法に戻す
	const choose = async (next: NotificationChannel) => {
		if (choosing()) {
			return;
		}
		const previous = channel();
		setChannel(next);
		setChoosing(true);
		try {
			const result = await props.controller.chooseChannel(next);
			showToast(result.success ? "success" : "error", result.message);
			if (!result.success) {
				setChannel(previous);
			}
		} catch {
			showToast("error", "通知の方法を変更できませんでした。時間をおいて再度お試しください。");
			setChannel(previous);
		} finally {
			if (mounted) {
				setChoosing(false);
			}
		}
	};

	const save = async (event: Event) => {
		event.preventDefault();
		if (saving()) {
			return;
		}
		setSaving(true);
		try {
			const result = await props.controller.save({
				...form(),
				port: Number(form().port),
				to: testTo(),
				templateId: templateId(),
			});
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				await load();
			}
		} catch {
			showToast(
				"error",
				"通知メールの設定を保存できませんでした。時間をおいて再度お試しください。",
			);
		} finally {
			if (mounted) {
				setSaving(false);
			}
		}
	};

	return (
		<section class="info-card" aria-labelledby="notification-heading">
			<h2 id="notification-heading">通知</h2>
			<p>
				目標の送信・一次評価の依頼は一次評価者に、目標の確定・要修正は本人に、一次評価の確定は二次評価者に知らせます。
			</p>

			<Show when={error()}>
				<div class="inline-alert" role="alert">
					<span>{error()}</span>
					<button type="button" class="secondary-action" onClick={() => void load()}>
						再読み込み
					</button>
				</div>
			</Show>

			<Show when={!loading()} fallback={<p class="page-note">通知の設定を読み込んでいます...</p>}>
				<fieldset class="notification-channel">
					<legend>通知の方法</legend>
					<label>
						<input
							type="radio"
							name="notification-channel"
							value="in_app"
							checked={channel() === "in_app"}
							disabled={choosing()}
							onChange={() => void choose("in_app")}
						/>
						アプリ内通知
						<span class="field-hint">画面上部のベルに届きます</span>
					</label>
					<label>
						<input
							type="radio"
							name="notification-channel"
							value="email"
							checked={channel() === "email"}
							disabled={choosing() || !verifiedAt()}
							onChange={() => void choose("email")}
						/>
						メール
					</label>
					<Show
						when={verifiedAt()}
						fallback={
							<p class="field-hint">メールは、下の送信テストに成功した設定を保存すると選べます。</p>
						}
					>
						{(at) => <p class="field-hint">送信テスト済み（{formatDateTime(at())}）</p>}
					</Show>
				</fieldset>
				<h3>メールの送信設定</h3>
				<p class="allocation-note">
					送信ポートは465（TLS）を指定してください。25と587は使用できません。保存したパスワードは、この画面には表示されません。変更するときだけ入力してください。
				</p>
				<form onSubmit={(event) => void save(event)}>
					<div class="allocation-form period-form">
						<label>
							SMTP ホスト
							<input
								type="text"
								required
								placeholder="smtp.example.jp"
								value={form().host}
								disabled={saving()}
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
								disabled={saving()}
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
								disabled={saving()}
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
								disabled={saving()}
								onInput={(event) => setForm({ ...form(), password: event.currentTarget.value })}
							/>
						</label>
					</div>
					<h4>送信テスト</h4>
					<p class="allocation-note">
						入力した設定で、選択した通知をサンプルの社員・評価期間で送信し、届いたときだけ設定を保存します。宛先は保存されません。
					</p>
					<div class="allocation-form period-form smtp-test-form">
						<label>
							宛先メールアドレス
							<input
								type="email"
								required
								autocomplete="off"
								value={testTo()}
								disabled={saving()}
								onInput={(event) => setTestTo(event.currentTarget.value)}
							/>
						</label>
						<label>
							通知パターン
							<select
								required
								value={templateId()}
								disabled={saving()}
								onChange={(event) => setTemplateId(event.currentTarget.value)}
							>
								<For each={NOTIFICATION_TEMPLATES}>
									{(template) => <option value={template.id}>{template.label}</option>}
								</For>
							</select>
						</label>
						<button type="submit" class="primary-action" disabled={saving()}>
							{saving() ? "送信中..." : "テストメールを送って保存する"}
						</button>
					</div>
				</form>
			</Show>
		</section>
	);
};

export default SmtpSettings;
