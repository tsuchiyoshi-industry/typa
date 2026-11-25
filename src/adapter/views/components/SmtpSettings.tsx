import {
	action,
	type Component,
	createMemo,
	createOptimistic,
	createSignal,
	Errored,
	For,
	flush,
	Loading,
	refresh,
	Show,
} from "solid-js";
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
	// 読み込みは非同期の memo。待つ間は <Loading>、失敗は <Errored> が出す
	const settings = createMemo(() => props.controller.load());
	// 保存済みの通知の方法。選んだ方法の保存に成功したら、読み直さずにここを書き換える
	const [savedChannel, setSavedChannel] = createSignal<NotificationChannel>(
		() => settings()?.channel ?? "in_app",
	);
	// 画面の選択は楽観的に先に切り替え、保存が終わると保存済みの方法に戻る(失敗すれば元の方法のまま)
	const [channel, setChannel] = createOptimistic<NotificationChannel>(() => savedChannel());
	const [choosing, setChoosing] = createOptimistic(false);
	const passwordSet = () => settings()?.passwordSet ?? false;
	const verifiedAt = () => settings()?.verifiedAt ?? null;
	// 入力欄は保存済みの設定から始め、打った内容で上書きする。保存して読み直すと、保存した値に戻る
	const [form, setForm] = createSignal(() => {
		const loaded = settings();
		return {
			host: loaded?.host ?? "",
			// まだ設定がなければ、使える 465 から始める(DB の初期値 587 は Edge Function から使えない)
			port: loaded?.host ? String(loaded.port) : "465",
			user: loaded?.user ?? "",
			password: "",
		};
	});
	/** 一部の欄だけを書き換える。値はハンドラーの中で先に読んで渡し、書き換えは前の書き込みに重ねる。 */
	const patchForm = (fields: Partial<ReturnType<typeof form>>) =>
		setForm((previous) => ({ ...previous, ...fields }));
	const [saving, setSaving] = createSignal(false);
	const [testTo, setTestTo] = createSignal("");
	const [templateId, setTemplateId] = createSignal<string>(NOTIFICATION_TEMPLATES[0].id);

	// 選んだらすぐ保存する
	const choose = action(function* (next: NotificationChannel) {
		setChannel(next);
		setChoosing(true);
		try {
			const result: { success: boolean; message: string } =
				yield props.controller.chooseChannel(next);
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				setSavedChannel(next);
			}
		} catch {
			showToast("error", "通知の方法を変更できませんでした。時間をおいて再度お試しください。");
		}
	});

	const save = async (event: Event) => {
		event.preventDefault();
		if (saving()) {
			return;
		}
		setSaving(true);
		// 2.0 では書いた値が次の flush まで読めない。続けて押されても、上の確認で止める
		flush();
		try {
			const result = await props.controller.save({
				...form(),
				port: Number(form().port),
				to: testTo(),
				templateId: templateId(),
			});
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				refresh(settings);
			}
		} catch {
			showToast(
				"error",
				"通知メールの設定を保存できませんでした。時間をおいて再度お試しください。",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section class="info-card" aria-labelledby="notification-heading">
			<h2 id="notification-heading">通知</h2>
			<p>
				目標の送信・一次評価の依頼は一次評価者に、目標の確定・要修正は本人に、一次評価の確定は二次評価者に知らせます。
			</p>

			<Errored
				fallback={(_, reset) => (
					<div class="inline-alert" role="alert">
						<span>通知の設定を読み込めませんでした。</span>
						<button
							type="button"
							class="secondary-action"
							onClick={() => {
								refresh(settings);
								reset();
							}}
						>
							再読み込み
						</button>
					</div>
				)}
			>
				<Loading fallback={<p class="page-note">通知の設定を読み込んでいます...</p>}>
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
								<p class="field-hint">
									メールは、下の送信テストに成功した設定を保存すると選べます。
								</p>
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
									onInput={(event) => patchForm({ host: event.currentTarget.value })}
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
									onInput={(event) => patchForm({ port: event.currentTarget.value })}
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
									onInput={(event) => patchForm({ user: event.currentTarget.value })}
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
									onInput={(event) => patchForm({ password: event.currentTarget.value })}
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
				</Loading>
			</Errored>
		</section>
	);
};

export default SmtpSettings;
