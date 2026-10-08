import { type Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { SmtpSettingsController } from "../../controllers/SmtpSettingsController";
import { showToast } from "../feedback";

interface SmtpSettingsProps {
	controller: Pick<SmtpSettingsController, "load" | "save">;
}

/** Admin が、通知メールを送る SMTP サーバーと送信元アドレスを決める。 */
const SmtpSettings: Component<SmtpSettingsProps> = (props) => {
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [passwordSet, setPasswordSet] = createSignal(false);
	const [form, setForm] = createSignal({ host: "", port: "587", user: "", password: "" });
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
		setBusy(true);
		try {
			const result = await props.controller.save({ ...form(), port: Number(form().port) });
			showToast(result.success ? "success" : "error", result.message);
			if (result.success) {
				await load();
			}
		} finally {
			if (mounted) {
				setBusy(false);
			}
		}
	};

	return (
		<section class="info-card" aria-labelledby="smtp-heading">
			<h2 id="smtp-heading">通知メール</h2>
			<p>
				一次評価の確定と評価の確定を、評価者にメールで知らせます。送信に使う SMTP
				サーバーと、送信元のメールアドレスを決めます。接続は STARTTLS です。
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
						{busy() ? "保存中..." : "通知メールの設定を保存する"}
					</button>
				</form>
			</Show>
		</section>
	);
};

export default SmtpSettings;
