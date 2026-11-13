import RefreshCw from "lucide-solid/icons/refresh-cw";
import { type Component, createSignal, onMount, Show } from "solid-js";
import {
	ACCOUNT_PASSWORD_RULE,
	generateTemporaryPassword,
	isValidAccountPassword,
} from "../../../domain/valueObjects/AccountPassword";

/**
 * Admin が社員に仮のパスワードを設定するダイアログ。本人に口頭や紙で伝えるので、見える欄に出す。
 * 推測されにくい文字列を最初から入れておき、閉じたら入力は消える(再表示しない)。
 */
const EmployeePasswordResetForm: Component<{
	name: string;
	employeeNo: string;
	/** 断られたら message をダイアログに出す。 */
	onReset: (password: string) => Promise<{ success: boolean; message: string }>;
	onClose: () => void;
}> = (props) => {
	let dialog!: HTMLDialogElement;
	let input!: HTMLInputElement;
	const [password, setPassword] = createSignal(generateTemporaryPassword());
	const [saving, setSaving] = createSignal(false);
	const [refusal, setRefusal] = createSignal("");
	const valid = () => isValidAccountPassword(password());

	onMount(() => {
		dialog.showModal();
		input.select();
	});
	const close = () => {
		setPassword("");
		dialog.close();
		props.onClose();
	};
	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!valid() || saving()) {
			return;
		}
		setSaving(true);
		setRefusal("");
		try {
			const result = await props.onReset(password());
			if (result.success) {
				close();
			} else {
				setRefusal(result.message);
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<dialog
			ref={dialog}
			class="confirm-dialog password-reset-dialog"
			aria-labelledby="password-reset-title"
			aria-describedby="password-reset-message"
			onCancel={(event) => {
				event.preventDefault();
				if (!saving()) {
					close();
				}
			}}
		>
			<form
				class="confirm-dialog__body"
				aria-busy={saving()}
				onSubmit={(event) => void submit(event)}
			>
				<h2 id="password-reset-title">{props.name}さんに仮のパスワードを設定</h2>
				<p id="password-reset-message">
					社員番号 {props.employeeNo}。登録と評価データはそのまま残ります。
				</p>
				<ul class="confirm-dialog__details">
					<li>いまのログインはすべて切れ、前のパスワードは使えなくなります。</li>
					<li>本人は最初のログインで自分のパスワードに変えるまで、何も見られません。</li>
					<li>設定したことは監査ログに残ります（パスワードは残りません）。</li>
				</ul>
				<div class="confirm-dialog__text">
					<label class="confirm-dialog__text-label" for="password-reset-input">
						仮のパスワード
					</label>
					<span class="password-reset-dialog__field">
						<input
							ref={input}
							id="password-reset-input"
							class="password-reset-dialog__input"
							type="text"
							autocomplete="off"
							autocapitalize="off"
							spellcheck={false}
							value={password()}
							disabled={saving()}
							aria-invalid={!valid()}
							aria-describedby="password-reset-rule"
							onInput={(event) => {
								setPassword(event.currentTarget.value);
								setRefusal("");
							}}
						/>
						<button
							type="button"
							class="secondary-action"
							disabled={saving()}
							onClick={() => {
								setPassword(generateTemporaryPassword());
								input.select();
							}}
						>
							<RefreshCw size={14} aria-hidden="true" />
							作り直す
						</button>
					</span>
					<small id="password-reset-rule" class="password-reset-dialog__rule">
						{ACCOUNT_PASSWORD_RULE}
					</small>
				</div>
				<Show when={refusal()}>
					<p class="password-reset-dialog__error" role="alert">
						{refusal()}
					</p>
				</Show>
				<div class="confirm-dialog__actions">
					<button type="button" class="secondary-action" disabled={saving()} onClick={close}>
						キャンセル
					</button>
					<button type="submit" class="primary-action" disabled={!valid() || saving()}>
						{saving() ? "設定中…" : "仮のパスワードを設定"}
					</button>
				</div>
			</form>
		</dialog>
	);
};

export default EmployeePasswordResetForm;
