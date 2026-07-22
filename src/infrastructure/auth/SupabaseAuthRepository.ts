import type {
	AuthRepository,
	AuthSession,
	PasswordResetResult,
	SignUpResult,
} from "../../domain/repositories/AuthRepository";
import { supabase } from "../db/supabase";

export class SupabaseAuthRepository implements AuthRepository {
	async getSession(): Promise<AuthSession | null> {
		const {
			data: { session },
		} = await supabase.auth.getSession();

		return session ? { userId: session.user.id } : null;
	}

	onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event, newSession) => {
			if (event === "SIGNED_OUT") {
				callback(null);
			} else if (newSession) {
				callback({ userId: newSession.user.id });
			}
		});

		return () => subscription.unsubscribe();
	}

	async getCurrentUserEmail(): Promise<string | null> {
		const {
			data: { user },
		} = await supabase.auth.getUser();

		return user?.email ?? null;
	}

	async signInWithPassword(
		email: string,
		password: string,
	): Promise<{ userId: string | null; error: Error | null }> {
		const { data, error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			return { userId: null, error };
		}

		return { userId: data.user?.id ?? null, error: null };
	}

	async signUp(email: string, password: string, employeeNo: string): Promise<SignUpResult> {
		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: { data: { employee_no: employeeNo } },
		});

		if (error) {
			return { status: "error", error };
		}

		// Supabaseの仕様: 既に登録済みのメールアドレスの場合、identitiesが空配列で返る
		if (data.user?.identities?.length === 0) {
			return { status: "already_registered" };
		}

		return { status: "created" };
	}

	async verifySignupOtp(
		email: string,
		token: string,
	): Promise<{ userId: string | null; error: Error | null }> {
		const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });

		if (error || !data.user) {
			return { userId: null, error: error ?? new Error("認証に失敗しました。") };
		}

		return { userId: data.user.id, error: null };
	}

	async resendSignupOtp(email: string): Promise<{ error: Error | null }> {
		const { error } = await supabase.auth.resend({ type: "signup", email });
		return { error };
	}

	async requestPasswordReset(email: string): Promise<{ error: Error | null }> {
		const { error } = await supabase.auth.resetPasswordForEmail(email);
		return { error };
	}

	async confirmPasswordReset(
		email: string,
		token: string,
		newPassword: string,
	): Promise<PasswordResetResult> {
		const { error: verifyError } = await supabase.auth.verifyOtp({
			email,
			token,
			type: "recovery",
		});

		if (verifyError) {
			return { status: "invalid_code", error: verifyError };
		}

		const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

		if (updateError) {
			return { status: "update_failed", error: updateError };
		}

		return { status: "success" };
	}

	async signOut(): Promise<void> {
		await supabase.auth.signOut();
	}
}
