import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import type { AccountController } from "../controllers/AccountController";
import LoadingView from "./components/LoadingView";
import { confirmAction } from "./feedback";

// ログインIDは社員番号。メールアドレスは、新規登録のときに認証コードを受け取るためだけに使う。
type ViewMode = "login" | "signup" | "otp-verify";

type LoginViewProps = {
	controller: AccountController;
	onRegistrationLinked?: () => Promise<void> | void;
};

const PASSWORD_RULE = "6文字以上で、大文字・小文字・数字をすべて含めてください。";

const LoginView = (props: LoginViewProps) => {
	const navigate = useNavigate();
	const [email, setEmail] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [confirmPassword, setConfirmPassword] = createSignal("");
	const [employeeNo, setEmployeeNo] = createSignal("");
	const [otp, setOtp] = createSignal("");
	// 認証コードは一度しか使えないため、確認が済んだことを覚えておく
	const [emailVerified, setEmailVerified] = createSignal(false);

	const [loading, setLoading] = createSignal(false);
	const [linkingEmployee, setLinkingEmployee] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [infoMessage, setInfoMessage] = createSignal<string | null>(null);
	const [employeeNoError, setEmployeeNoError] = createSignal<string | null>(null);

	const [viewMode, setViewMode] = createSignal<ViewMode>("login");

	// 会社のメールドメイン(例: @example.jp)。DB の設定から読む
	const [requiredDomain, setRequiredDomain] = createSignal("");
	onMount(async () => {
		const suffix = await props.controller.requiredEmailSuffix().catch(() => "");
		setRequiredDomain(suffix);
		if (!suffix) {
			setErrorMessage(
				"会社ドメインの設定を読み込めませんでした。通信状況を確認して、アプリを開き直してください。",
			);
		}
	});

	const passwordMismatch = createMemo(
		() =>
			viewMode() === "otp-verify" &&
			confirmPassword().length > 0 &&
			password() !== confirmPassword(),
	);

	/** ドメイン違いでボタンが押せない理由を、入力欄の下に出すための判定。 */
	const emailDomainError = createMemo(() => {
		const currentEmail = email().trim();
		if (
			!requiredDomain() ||
			!currentEmail.includes("@") ||
			currentEmail.endsWith(requiredDomain())
		) {
			return null;
		}
		return `${requiredDomain()} で終わる会社のメールアドレスを入力してください。`;
	});

	const isSubmitDisabled = createMemo(() => {
		if (loading()) {
			return true;
		}

		// 新規登録の1歩目: 認証コードの送付先は、指定ドメインで終わるメールアドレスに限る
		// これにより、正しいドメインを打ち切るまでボタンは活性化しません
		if (viewMode() === "signup") {
			const currentEmail = email().trim();
			return !(currentEmail && requiredDomain() && currentEmail.endsWith(requiredDomain()));
		}

		if (!employeeNo().trim() || !password()) {
			return true;
		}

		// 新規登録の2歩目: 認証コードとパスワードの確認も必要
		return (
			viewMode() === "otp-verify" && (!otp().trim() || !confirmPassword() || passwordMismatch())
		);
	});

	// --- モード切り替え（フォームリセット付き） ----------------------
	const switchMode = (mode: ViewMode, customMessage: string | null = null) => {
		setViewMode(mode);
		setErrorMessage(customMessage);
		setInfoMessage(null);
		setEmployeeNoError(null);
		setOtp("");
		setPassword("");
		setConfirmPassword("");
		// 登録をやめたら、メールアドレスの確認用セッションを共有PCに残さない
		if (emailVerified()) {
			setEmailVerified(false);
			void props.controller.signOut();
		}
	};

	// --- 【ログイン処理】 -------------------------------------------
	const handleLogin = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const status = await props.controller.signIn(employeeNo(), password());
		setLoading(false);

		if (status === "invalid_credentials") {
			setErrorMessage(
				"社員番号またはパスワードが正しくありません。初めて利用する場合は、新規登録をしてください。",
			);
		} else if (status === "registration_incomplete") {
			// 登録が社員番号の紐付けの前で止まったアカウント。新規登録をやり直すと続きから再開できる
			switchMode("signup", "登録が完了していません。新規登録をやり直してください。");
		} else {
			navigate("/");
		}
	};

	// --- 【新規登録 1: 認証コードを送る】 ----------------------------
	const handleSendCode = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const sent = await props.controller.sendVerificationCode(email().trim());
		setLoading(false);

		if (!sent) {
			setErrorMessage("認証コードを送信できませんでした。しばらくしてから再度お試しください。");
			return;
		}

		switchMode("otp-verify");
	};

	// --- 【新規登録 2: 認証コードと社員番号を確かめて登録する】 ------
	const handleRegister = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);
		setInfoMessage(null);
		setEmployeeNoError(null);

		const status = await props.controller.register({
			employeeNo: employeeNo(),
			password: password(),
			email: email().trim(),
			// 社員番号やパスワードを直して送り直すときは、済んだ確認を繰り返さない
			verificationCode: emailVerified() ? undefined : otp().trim(),
		});
		setLoading(false);
		// 認証コードの確認が済めば、以降の失敗で送り直しても確認は繰り返さない
		if (status !== "invalid_code") {
			setEmailVerified(true);
		}

		switch (status) {
			case "invalid_code":
				setErrorMessage("認証コードが正しくないか、有効期限が切れています。");
				return;
			case "employee_registered":
				setEmployeeNoError(
					"この社員番号は既に登録されています。心当たりがない場合は、管理者に連絡してください。",
				);
				return;
			case "employee_not_found":
				setEmployeeNoError("この社員番号は見つかりません。入力内容を確認してください。");
				return;
			case "stalled_account":
				setErrorMessage(
					"この社員番号は登録の途中で止まっています。前回と同じパスワードを入力するか、管理者に連絡してください。",
				);
				return;
			case "weak_password":
				setErrorMessage(`パスワードが要件を満たしていません。${PASSWORD_RULE}`);
				return;
			case "signup_failed":
				setErrorMessage(
					`登録できませんでした。社員番号とパスワードを確認してください。パスワードは${PASSWORD_RULE}`,
				);
				return;
			case "link_failed":
				// 確認用セッションは use case が破棄済み。登録は最初からやり直す
				setEmailVerified(false);
				switchMode("signup", "登録を完了できませんでした。もう一度やり直してください。");
				return;
		}

		setLinkingEmployee(true);
		// ログインに使うのは社員番号なので、登録の最後に必ず見せる
		await confirmAction({
			title: `あなたの社員番号は「${employeeNo()}」です`,
			message:
				"登録が完了しました。この社員番号は、このシステムにログインするときに必ず必要になります。忘れないように覚えておいてください。",
			confirmLabel: "覚えました",
			acknowledgeOnly: true,
		});
		await props.onRegistrationLinked?.();
		navigate("/");
	};

	// --- 認証コード再送処理 ------------------------------------------
	const handleResendOtp = async () => {
		setLoading(true);
		setErrorMessage(null);
		setInfoMessage(null);

		if (!(await props.controller.sendVerificationCode(email().trim()))) {
			setErrorMessage("認証コードの再送に失敗しました。しばらくしてから再度お試しください。");
		} else {
			setInfoMessage("認証コードを再送しました。メールをご確認ください。");
		}

		setLoading(false);
	};

	const EmployeeNoField = () => (
		<div class="login-fieldset">
			<label for="employee-no">社員番号</label>
			<input
				id="employee-no"
				type="text"
				autocomplete="off"
				value={employeeNo()}
				onInput={(e) => {
					// 全角半角の混在や末尾のスペースによるエラーを防ぐためトリム処理を推奨
					setEmployeeNo(e.currentTarget.value.trim());
					setEmployeeNoError(null);
				}}
				required
			/>
			<Show when={employeeNoError()}>
				<p class="field-error" role="alert">
					{employeeNoError()}
				</p>
			</Show>
		</div>
	);

	const Messages = () => (
		<>
			<Show when={errorMessage()}>
				<p class="error-message" role="alert">
					{errorMessage()}
				</p>
			</Show>
			<Show when={infoMessage()}>
				<p class="info-message" role="status">
					{infoMessage()}
				</p>
			</Show>
		</>
	);

	return (
		<Show when={!linkingEmployee()} fallback={<LoadingView />}>
			<div class="login-cover">
				<div class="auth-card">
					<div class="auth-brand">
						<span class="brand-logo">TYPA</span>
						<span>人事考課シート</span>
					</div>

					{/* ログイン画面 */}
					<Show when={viewMode() === "login"}>
						<h2>ログイン</h2>

						<form class="login-form" onSubmit={handleLogin}>
							<EmployeeNoField />

							<div class="login-fieldset">
								<label for="password">パスワード</label>
								<input
									id="password"
									type="password"
									autocomplete="current-password"
									value={password()}
									onInput={(e) => setPassword(e.currentTarget.value)}
									required
								/>
								<p class="field-hint">パスワードを忘れた場合は、管理者に連絡してください。</p>
							</div>

							<Messages />

							<button type="submit" disabled={isSubmitDisabled()}>
								{loading() ? "処理中..." : "ログイン"}
							</button>
						</form>

						<div class="auth-toggle">
							<p>
								初めて利用しますか？
								<button type="button" class="link-button" onClick={() => switchMode("signup")}>
									新規登録
								</button>
							</p>
						</div>
					</Show>

					{/* 新規登録 1: 認証コードの送付先 */}
					<Show when={viewMode() === "signup"}>
						<h2>新規登録</h2>
						<p class="info-text">
							認証コードを受け取るメールアドレスを入力してください。共有PCのメールアドレスでかまいません。ログインには社員番号を使います。
						</p>

						<form class="login-form" onSubmit={handleSendCode}>
							<div class="login-fieldset">
								<label for="email">メールアドレス</label>
								<input
									id="email"
									type="email"
									autocomplete="email"
									value={email()}
									onInput={(e) => setEmail(e.currentTarget.value)}
									placeholder={requiredDomain() ? `name${requiredDomain()}` : undefined}
									aria-invalid={emailDomainError() !== null}
									required
								/>
								<Show when={emailDomainError()}>
									<p class="field-error" role="alert">
										{emailDomainError()}
									</p>
								</Show>
							</div>

							<Messages />

							<button type="submit" disabled={isSubmitDisabled()}>
								{loading() ? "送信中..." : "認証コードを受け取る"}
							</button>
						</form>

						<div class="auth-toggle">
							<p>
								既に登録済みですか？
								<button type="button" class="link-button" onClick={() => switchMode("login")}>
									ログイン
								</button>
							</p>
						</div>
					</Show>

					{/* 新規登録 2: 認証コード・社員番号・パスワード */}
					<Show when={viewMode() === "otp-verify"}>
						<h2>新規登録</h2>
						<p class="info-text">
							<strong>{email()}</strong> 宛に認証コードを送信しました。
						</p>

						<form class="login-form" onSubmit={handleRegister}>
							<div class="login-fieldset">
								<label for="otp">認証コード</label>
								<input
									id="otp"
									type="text"
									inputMode="numeric"
									autocomplete="one-time-code"
									placeholder="00000000"
									maxLength={8}
									value={otp()}
									onInput={(e) => setOtp(e.currentTarget.value)}
									disabled={emailVerified()}
									required
								/>
							</div>

							<EmployeeNoField />

							<div class="login-fieldset">
								<label for="new-password">パスワード</label>
								<input
									id="new-password"
									type="password"
									autocomplete="new-password"
									value={password()}
									onInput={(e) => setPassword(e.currentTarget.value)}
									required
								/>
								<p class="field-hint">{PASSWORD_RULE}</p>
							</div>

							<div class="login-fieldset">
								<label for="confirm-password">パスワード（確認）</label>
								<input
									id="confirm-password"
									type="password"
									autocomplete="new-password"
									value={confirmPassword()}
									onInput={(e) => setConfirmPassword(e.currentTarget.value)}
									required
								/>
								<Show when={passwordMismatch()}>
									<p class="field-error" role="alert">
										パスワードが一致しません
									</p>
								</Show>
							</div>

							<Messages />

							<button type="submit" disabled={isSubmitDisabled()}>
								{loading() ? "登録中..." : "登録する"}
							</button>
						</form>

						<div class="auth-toggle">
							<button
								type="button"
								class="link-button"
								disabled={loading() || emailVerified()}
								onClick={handleResendOtp}
							>
								認証コードを再送する
							</button>
							<span class="separator">|</span>
							<button type="button" class="link-button" onClick={() => switchMode("signup")}>
								メールアドレスの入力に戻る
							</button>
						</div>
					</Show>
				</div>
			</div>
		</Show>
	);
};

export default LoginView;
