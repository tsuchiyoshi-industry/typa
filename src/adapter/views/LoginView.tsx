import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, Show } from "solid-js";
import { SupabaseAuthRepository } from "../../infrastructure/auth/SupabaseAuthRepository";
import { SupabaseEmployeeRepository } from "../../infrastructure/repositories/SupabaseEmployeeRepository";
import LoadingView from "./components/LoadingView";

type ViewMode = "login" | "signup" | "otp-verify" | "forgot-password" | "reset-password";

type LoginViewProps = {
	onRegistrationLinked?: () => Promise<void> | void;
};

//FIXME: パスワードが６文字以上大文字・小文字・数字を含むということをユーザーに伝える必要があるかも（サインアップの失敗理由がわからない）
const LoginView = (props: LoginViewProps) => {
	const navigate = useNavigate();
	const [email, setEmail] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [confirmPassword, setConfirmPassword] = createSignal("");
	const [employeeNo, setEmployeeNo] = createSignal("");
	const [otp, setOtp] = createSignal("");

	const [loading, setLoading] = createSignal(false);
	const [linkingEmployee, setLinkingEmployee] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [employeeNoError, setEmployeeNoError] = createSignal<string | null>(null);

	const [viewMode, setViewMode] = createSignal<ViewMode>("login");

	const employeeRepository = new SupabaseEmployeeRepository();
	const authRepository = new SupabaseAuthRepository();

	const requiredDomain = import.meta.env.VITE_REQUIRED_DOMAIN;

	const passwordMismatch = createMemo(
		() =>
			(viewMode() === "signup" || viewMode() === "reset-password") &&
			confirmPassword().length > 0 &&
			password() !== confirmPassword(),
	);

	const isSubmitDisabled = createMemo(() => {
		// 1. ローディング中は常に無効
		if (loading()) {
			return true;
		}

		const currentEmail = email().trim();
		const currentPassword = password();
		const domain = requiredDomain || "";

		// 2. 基本バリデーション（メールとパスワードが空なら無効）
		if (!currentEmail || !currentPassword) {
			return true;
		}

		// 3. ドメインチェック（指定ドメインで終わっていない場合は無効）
		// これにより、正しいドメインを打ち切るまでボタンは活性化しません
		if (!currentEmail.endsWith(domain)) {
			return true;
		}

		// 4. 新規登録（signup）時のみ適用する追加ルール
		if (viewMode() === "signup") {
			// パスワード一致チェック
			if (passwordMismatch()) {
				return true;
			}
			// 社員番号が空なら無効
			if (!employeeNo().trim()) {
				return true;
			}
		}

		// すべての条件をクリアしたらボタンを有効化（false）
		return false;
	});

	// --- モード切り替え（フォームリセット付き） ----------------------
	const switchMode = (mode: ViewMode, customMessage: string | null = null) => {
		setViewMode(mode);
		setErrorMessage(customMessage);
		setEmployeeNoError(null);
		setOtp("");
		if (mode === "login" || mode === "forgot-password" || mode === "reset-password") {
			setConfirmPassword("");
		}
		if (mode === "forgot-password" || mode === "reset-password") {
			setPassword("");
		}
	};

	// --- 【ログイン処理】 -------------------------------------------
	const handleLogin = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const { userId, error } = await authRepository.signInWithPassword(email(), password());

		if (error) {
			setErrorMessage("メールアドレスまたはパスワードが正しくありません。");
			setLoading(false);
			return;
		}

		if (!userId) {
			setErrorMessage("予期せぬエラーが発生しました。");
			setLoading(false);
			return;
		}

		// RLS突破後：社員情報の紐づけ状況を確認
		// ※ Repositoryに checkUserLinked(userId: string): Promise<boolean> が実装されている想定
		const isLinked = await employeeRepository.checkUserLinked(userId);

		if (!isLinked) {
			// シナリオ2への対応: 認証済みだが社員番号が未紐づけの場合
			await authRepository.signOut();
			switchMode("signup", "社員番号の設定が未完了です。再度入力して登録を完了させてください。");
			setLoading(false);
			return;
		}

		navigate("/");
		setLoading(false);
	};

	// --- 【新規登録処理】 -------------------------------------------
	const handleSignup = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);
		setEmployeeNoError(null);

		if (password() !== confirmPassword()) {
			setLoading(false);
			return;
		}

		const result = await authRepository.signUp(email(), password(), employeeNo());

		if (result.status === "error") {
			setErrorMessage("登録に失敗しました。入力内容を確認してください。");
			setLoading(false);
			return;
		}

		if (result.status === "already_registered") {
			switchMode("login", "このメールアドレスは既に登録されています。ログインをお試しください。");
			setLoading(false);
			return;
		}

		setViewMode("otp-verify");
		setLoading(false);
	};

	// --- 【OTP検証処理】 -------------------------------------------
	const handleVerifyOtp = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const { userId, error } = await authRepository.verifySignupOtp(email(), otp());

		if (error || !userId) {
			setErrorMessage("認証コードが正しくないか、有効期限が切れています。");
			setLoading(false);
			return;
		}

		setLoading(false);
		setLinkingEmployee(true);

		const linked = await employeeRepository.linkUserToEmployee(employeeNo(), userId);

		if (linked) {
			await props.onRegistrationLinked?.();
			navigate("/");
		} else {
			await authRepository.signOut();
			setLinkingEmployee(false);
			switchMode("signup");
			setEmployeeNoError("社員番号が誤りです。入力内容を確認してください。");
		}
	};

	// --- OTP再送処理 ------------------------------------------------
	const handleResendOtp = async () => {
		setLoading(true);
		setErrorMessage(null);

		const { error } = await authRepository.resendSignupOtp(email());
		if (error) {
			setErrorMessage("認証コードの再送に失敗しました。しばらくしてから再度お試しください。");
		}

		setLoading(false);
	};

	// --- 【パスワード再設定リクエスト】 -------------------------------------------
	const handleRequestPasswordReset = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const { error } = await authRepository.requestPasswordReset(email());

		if (error) {
			setErrorMessage("確認コードの送信に失敗しました。しばらくしてから再度お試しください。");
			setLoading(false);
			return;
		}

		setLoading(false);
		switchMode("reset-password");
	};

	// --- 確認コード再送処理（パスワード再設定） ----------------------------------
	const handleResendPasswordResetOtp = async () => {
		setLoading(true);
		setErrorMessage(null);

		const { error } = await authRepository.requestPasswordReset(email());
		if (error) {
			setErrorMessage("確認コードの再送に失敗しました。しばらくしてから再度お試しください。");
		}

		setLoading(false);
	};

	// --- 【パスワード再設定】 -------------------------------------------------
	const handleResetPassword = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		if (password() !== confirmPassword()) {
			setLoading(false);
			return;
		}

		const result = await authRepository.confirmPasswordReset(email(), otp(), password());

		if (result.status === "invalid_code") {
			setErrorMessage("確認コードが正しくないか、有効期限が切れています。");
			setLoading(false);
			return;
		}

		if (result.status === "update_failed") {
			setErrorMessage("パスワードの更新に失敗しました。入力内容を確認してください。");
			setLoading(false);
			return;
		}

		navigate("/");
		setLoading(false);
	};

	if (linkingEmployee()) {
		return <LoadingView />;
	}

	return (
		<div class="login-cover">
			<div class="auth-card">
				{/* OTP入力画面 */}
				<Show when={viewMode() === "otp-verify"}>
					<h2>認証コード入力</h2>
					<p class="info-text">
						<strong>{email()}</strong> 宛に認証コードを送信しました。
					</p>

					<form class="login-form" onSubmit={handleVerifyOtp}>
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
								required
							/>
						</div>

						<Show when={errorMessage()}>
							<p class="error-message" role="alert">
								{errorMessage()}
							</p>
						</Show>

						<button type="submit" disabled={loading()}>
							{loading() ? "検証中..." : "認証する"}
						</button>
					</form>

					<div class="auth-toggle">
						<button
							type="button"
							class="link-button"
							disabled={loading()}
							onClick={handleResendOtp}
						>
							認証コードを再送する
						</button>
						<span class="separator">|</span>
						<button type="button" class="link-button" onClick={() => switchMode("signup")}>
							登録画面に戻る
						</button>
					</div>
				</Show>

				{/* ログイン・新規登録画面 */}
				<Show when={viewMode() === "login" || viewMode() === "signup"}>
					<h2>{viewMode() === "signup" ? "新規登録" : "ログイン"}</h2>

					<form class="login-form" onSubmit={viewMode() === "signup" ? handleSignup : handleLogin}>
						<div class="login-fieldset">
							<label for="email">メールアドレス</label>
							<input
								id="email"
								type="email"
								autocomplete="email"
								value={email()}
								onInput={(e) => setEmail(e.currentTarget.value)}
								required
							/>
						</div>

						<div class="login-fieldset">
							<label for="password">パスワード</label>
							<input
								id="password"
								type="password"
								autocomplete={viewMode() === "signup" ? "new-password" : "current-password"}
								value={password()}
								onInput={(e) => setPassword(e.currentTarget.value)}
								required
							/>
							<Show when={viewMode() === "login"}>
								<button
									type="button"
									class="link-button forgot-password-link"
									onClick={() => switchMode("forgot-password")}
								>
									パスワードをお忘れですか？
								</button>
							</Show>
						</div>

						<Show when={viewMode() === "signup"}>
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
						</Show>

						<Show when={errorMessage()}>
							<p class="error-message" role="alert">
								{errorMessage()}
							</p>
						</Show>

						<button type="submit" disabled={isSubmitDisabled()}>
							{loading()
								? "処理中..."
								: viewMode() === "signup"
									? "登録して認証コードを受け取る"
									: "ログイン"}
						</button>
					</form>

					<div class="auth-toggle">
						<p>
							{viewMode() === "signup"
								? "既にアカウントをお持ちですか？"
								: "アカウントをお持ちでないですか？"}
							<button
								type="button"
								class="link-button"
								onClick={() => switchMode(viewMode() === "signup" ? "login" : "signup")}
							>
								{viewMode() === "signup" ? "ログイン" : "新規登録"}
							</button>
						</p>
					</div>
				</Show>

				{/* パスワード再設定リクエスト画面 */}
				<Show when={viewMode() === "forgot-password"}>
					<h2>パスワード再設定</h2>
					<p class="info-text">
						登録済みのメールアドレスを入力してください。確認コードを送信します。
					</p>

					<form class="login-form" onSubmit={handleRequestPasswordReset}>
						<div class="login-fieldset">
							<label for="reset-email">メールアドレス</label>
							<input
								id="reset-email"
								type="email"
								autocomplete="email"
								value={email()}
								onInput={(e) => setEmail(e.currentTarget.value)}
								required
							/>
						</div>

						<Show when={errorMessage()}>
							<p class="error-message" role="alert">
								{errorMessage()}
							</p>
						</Show>

						<button type="submit" disabled={loading() || !email().trim()}>
							{loading() ? "送信中..." : "確認コードを送信"}
						</button>
					</form>

					<div class="auth-toggle">
						<button type="button" class="link-button" onClick={() => switchMode("login")}>
							ログインに戻る
						</button>
					</div>
				</Show>

				{/* パスワード再設定画面 */}
				<Show when={viewMode() === "reset-password"}>
					<h2>パスワード再設定</h2>
					<p class="info-text">
						<strong>{email()}</strong> 宛に確認コードを送信しました。
					</p>

					<form class="login-form" onSubmit={handleResetPassword}>
						<div class="login-fieldset">
							<label for="reset-otp">確認コード</label>
							<input
								id="reset-otp"
								type="text"
								inputMode="numeric"
								autocomplete="one-time-code"
								placeholder="00000000"
								maxLength={8}
								value={otp()}
								onInput={(e) => setOtp(e.currentTarget.value)}
								required
							/>
						</div>

						<div class="login-fieldset">
							<label for="new-password">新しいパスワード</label>
							<input
								id="new-password"
								type="password"
								autocomplete="new-password"
								value={password()}
								onInput={(e) => setPassword(e.currentTarget.value)}
								required
							/>
						</div>

						<div class="login-fieldset">
							<label for="confirm-new-password">新しいパスワード（確認）</label>
							<input
								id="confirm-new-password"
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

						<Show when={errorMessage()}>
							<p class="error-message" role="alert">
								{errorMessage()}
							</p>
						</Show>

						<button
							type="submit"
							disabled={
								loading() ||
								!otp().trim() ||
								!password() ||
								!confirmPassword() ||
								passwordMismatch()
							}
						>
							{loading() ? "更新中..." : "パスワードを更新する"}
						</button>
					</form>

					<div class="auth-toggle">
						<button
							type="button"
							class="link-button"
							disabled={loading()}
							onClick={handleResendPasswordResetOtp}
						>
							確認コードを再送する
						</button>
						<span class="separator">|</span>
						<button type="button" class="link-button" onClick={() => switchMode("login")}>
							ログインに戻る
						</button>
					</div>
				</Show>
			</div>
		</div>
	);
};

export default LoginView;
