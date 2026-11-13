export type AuthSession = {
	userId: string;
};

export type SignUpResult =
	| { status: "created"; userId: string }
	| { status: "already_registered" }
	| { status: "error"; error: Error };

/**
 * ログインIDは社員番号。メールアドレスは、新規登録のときに認証コードを受け取るためだけに使う
 * (共有PCのメールアドレスを複数の社員が使ってよい)。
 */
export interface AuthRepository {
	getSession(): Promise<AuthSession | null>;
	onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;
	/**
	 * reason: Auth に問い合わせなかった理由。unconfigured はログイン用アドレスの会社ドメインが未設定、
	 * unavailable は会社ドメインを読めなかった(通信の失敗など)。どちらもパスワード違いではない。
	 */
	signInWithPassword(
		employeeNo: string,
		password: string,
	): Promise<{
		userId: string | null;
		error: Error | null;
		reason?: "unconfigured" | "unavailable";
	}>;
	sendEmailCode(email: string): Promise<{ error: Error | null }>;
	/** 成功すると、そのメールアドレスの確認用セッションになる(社員にはまだ紐付かない)。 */
	verifyEmailCode(email: string, token: string): Promise<{ error: Error | null }>;
	/** 社員番号のログイン用アカウントを作る。社員への紐付けは EmployeeRepository.completeRegistration。 */
	signUp(employeeNo: string, password: string): Promise<SignUpResult>;
	signOut(): Promise<void>;
	/**
	 * ログイン中の本人のパスワードを変える。reason: same_password は今と同じ、weak_password は Auth の条件を満たさない。
	 */
	changePassword(
		password: string,
	): Promise<{ error: Error | null; reason?: "same_password" | "weak_password" }>;
	/**
	 * いまのログインを、アプリを閉じた後もこの PC に残すかどうか。残さなければ、閉じるとログアウトになる。
	 * 社員マスタの設定(EmployeeRepository.findKeepSignedIn)を、ログインのたびに伝える。
	 */
	keepSignedIn(enabled: boolean): void;
}
