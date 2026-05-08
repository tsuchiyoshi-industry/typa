import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, Show } from "solid-js";
import { supabase } from "../../infrastructure/db/supabase";
import { SupabaseEmployeeRepository } from "../../infrastructure/repositories/SupabaseEmployeeRepository";

type ViewMode = "login" | "signup" | "otp-verify";

const LoginView = () => {
	const navigate = useNavigate();
	const [email, setEmail] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [confirmPassword, setConfirmPassword] = createSignal("");
	const [employeeNo, setEmployeeNo] = createSignal("");
	const [otp, setOtp] = createSignal("");

	const [loading, setLoading] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [employeeNoError, setEmployeeNoError] = createSignal<string | null>(null);

	const [viewMode, setViewMode] = createSignal<ViewMode>("login");
	const [otpVerifyType, setOtpVerifyType] = createSignal<"signup" | "email">("signup");

	const employeeRepository = new SupabaseEmployeeRepository();

	const passwordMismatch = createMemo(
		() =>
			viewMode() === "signup" && confirmPassword().length > 0 && password() !== confirmPassword(),
	);

	// --- モード切り替え（フォームリセット付き） ----------------------
	const switchMode = (mode: ViewMode, customMessage: string | null = null) => {
		setViewMode(mode);
		setErrorMessage(customMessage);
		setEmployeeNoError(null);
		setOtp("");
		if (mode === "login") {
			setConfirmPassword("");
		}
	};

	// --- 【ログイン処理】 -------------------------------------------
	const handleLogin = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const { data, error } = await supabase.auth.signInWithPassword({
			email: email(),
			password: password(),
		});

		if (error) {
			setErrorMessage("メールアドレスまたはパスワードが正しくありません。");
			setLoading(false);
			return;
		}

		if (!data.user) {
			setErrorMessage("予期せぬエラーが発生しました。");
			setLoading(false);
			return;
		}

		// RLS突破後：社員情報の紐づけ状況を確認
		// ※ Repositoryに checkUserLinked(userId: string): Promise<boolean> が実装されている想定
		const isLinked = await employeeRepository.checkUserLinked(data.user.id);

		if (!isLinked) {
			// シナリオ2への対応: 認証済みだが社員番号が未紐づけの場合
			await supabase.auth.signOut();
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

		const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
			email: email(),
			password: password(),
			options: { data: { employee_no: employeeNo() } },
		});

		// シナリオ1: 正常な新規登録（identitiesが存在する場合＝新規ユーザー）
		if (!signUpError && signUpData.user?.identities && signUpData.user.identities.length > 0) {
			setOtpVerifyType("signup");
			setViewMode("otp-verify");
			setLoading(false);
			return;
		}

		// --- 以下、既に登録されている（可能性がある）場合のエッジケース処理 ---

		// 背後でパスワードログインを試行し、本人の確認とRLSの突破を図る
		const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
			email: email(),
			password: password(),
		});

		if (signInError || !signInData.user) {
			// パスワードが違う＝別パスワードで登録済みの別ユーザー
			switchMode("login", "このメールアドレスは既に登録されています。ログインをお試しください。");
			setLoading(false);
			return;
		}

		// ログイン成功（本人確認＆RLS突破完了）
		const userId = signInData.user.id;
		const isLinked = await employeeRepository.checkUserLinked(userId);

		if (isLinked) {
			// シナリオ3: メール認証済み ＆ 社員番号紐づけ済み
			await supabase.auth.signOut(); // 状態をリセット
			switchMode("login", "既にアカウントが登録されています。こちらからログインしてください。");
			setLoading(false);
			return;
		}

		// シナリオ2: メール認証済み ＆ 社員番号【未紐づけ】（中断からの復旧など）
		const empNo = employeeNo();
		const linkedSuccessfully = await employeeRepository.linkUserToEmployee(empNo, userId);

		if (linkedSuccessfully) {
			navigate("/"); // 紐づけ成功、そのままログイン状態として扱う
		} else {
			await supabase.auth.signOut(); // 失敗した場合は一度ログアウト
			setEmployeeNoError("社員番号が誤りです。入力内容を確認してください。");
		}

		setLoading(false);
	};

	// --- 【OTP検証処理】 -------------------------------------------
	const handleVerifyOtp = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const { error, data } = await supabase.auth.verifyOtp({
			email: email(),
			token: otp(),
			type: otpVerifyType(),
		});

		if (error || !data.user) {
			setErrorMessage("認証コードが正しくないか、有効期限が切れています。");
			setLoading(false);
			return;
		}

		// 認証成功・RLS突破後、社員番号の紐づけを実行
		const empNo = (data.user.user_metadata?.employee_no as string) || employeeNo();
		const linked = await employeeRepository.linkUserToEmployee(empNo, data.user.id);

		if (linked) {
			navigate("/");
		} else {
			await supabase.auth.signOut();
			switchMode("signup");
			setEmployeeNoError("社員番号が誤りです。入力内容を確認してください。");
		}
		setLoading(false);
	};

	// --- OTP再送処理 ------------------------------------------------
	const handleResendOtp = async () => {
		setLoading(true);
		setErrorMessage(null);

		const resendFn =
			otpVerifyType() === "email"
				? supabase.auth.signInWithOtp({ email: email() })
				: supabase.auth.resend({ type: "signup", email: email() });

		const { error } = await resendFn;
		if (error) {
			setErrorMessage("認証コードの再送に失敗しました。しばらくしてから再度お試しください。");
		}

		setLoading(false);
	};

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
				<Show when={viewMode() !== "otp-verify"}>
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

						<button type="submit" disabled={loading() || passwordMismatch()}>
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
			</div>
		</div>
	);
};

export default LoginView;
