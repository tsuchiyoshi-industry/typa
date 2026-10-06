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
	getCurrentEmployeeNo(): Promise<string | null>;
	signInWithPassword(
		employeeNo: string,
		password: string,
	): Promise<{ userId: string | null; error: Error | null }>;
	sendEmailCode(email: string): Promise<{ error: Error | null }>;
	/** 成功すると、そのメールアドレスの確認用セッションになる(社員にはまだ紐付かない)。 */
	verifyEmailCode(email: string, token: string): Promise<{ error: Error | null }>;
	/** contactEmail は認証コードを受け取ったメールアドレス。評価者への通知の宛先になる。 */
	signUp(employeeNo: string, password: string, contactEmail: string): Promise<SignUpResult>;
	signOut(): Promise<void>;
}
