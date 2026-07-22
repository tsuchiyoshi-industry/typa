export type AuthSession = {
	userId: string;
};

export type SignUpResult =
	| { status: "created" }
	| { status: "already_registered" }
	| { status: "error"; error: Error };

export type PasswordResetResult =
	| { status: "success" }
	| { status: "invalid_code"; error: Error }
	| { status: "update_failed"; error: Error };

export interface AuthRepository {
	getSession(): Promise<AuthSession | null>;
	onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;
	getCurrentUserEmail(): Promise<string | null>;
	signInWithPassword(
		email: string,
		password: string,
	): Promise<{ userId: string | null; error: Error | null }>;
	signUp(email: string, password: string, employeeNo: string): Promise<SignUpResult>;
	verifySignupOtp(
		email: string,
		token: string,
	): Promise<{ userId: string | null; error: Error | null }>;
	resendSignupOtp(email: string): Promise<{ error: Error | null }>;
	requestPasswordReset(email: string): Promise<{ error: Error | null }>;
	confirmPasswordReset(
		email: string,
		token: string,
		newPassword: string,
	): Promise<PasswordResetResult>;
	signOut(): Promise<void>;
}
