import type {
	AuthRepository,
	AuthSession,
	SignUpResult,
} from "../../domain/repositories/AuthRepository";
import { supabase } from "../db/supabase";
import { toAuthEmail } from "./authEmail";

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

	async getCurrentEmployeeNo(): Promise<string | null> {
		const {
			data: { user },
		} = await supabase.auth.getUser();

		return (user?.user_metadata?.employee_no as string | undefined) ?? null;
	}

	async signInWithPassword(
		employeeNo: string,
		password: string,
	): Promise<{ userId: string | null; error: Error | null }> {
		const email = toAuthEmail(employeeNo);
		if (!email) {
			return { userId: null, error: new Error("社員番号の形式が正しくありません。") };
		}

		const { data, error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			return { userId: null, error };
		}

		return { userId: data.user?.id ?? null, error: null };
	}

	async sendEmailCode(email: string): Promise<{ error: Error | null }> {
		const { error } = await supabase.auth.signInWithOtp({ email });
		return { error };
	}

	async verifyEmailCode(email: string, token: string): Promise<{ error: Error | null }> {
		const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
		return { error };
	}

	async signUp(employeeNo: string, password: string, contactEmail: string): Promise<SignUpResult> {
		const email = toAuthEmail(employeeNo);
		if (!email) {
			return { status: "error", error: new Error("社員番号の形式が正しくありません。") };
		}

		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: { data: { employee_no: employeeNo, contact_email: contactEmail } },
		});

		if (error) {
			return error.code === "user_already_exists"
				? { status: "already_registered" }
				: { status: "error", error };
		}

		// メール確認が有効なプロジェクトでは、登録済みのアドレスは identities が空配列で返る
		if (data.user?.identities?.length === 0) {
			return { status: "already_registered" };
		}

		// 内部用アドレスにはメールが届かないため、メール確認が有効だとログインできる状態にならない
		if (!data.user || !data.session) {
			console.error("Sign-up returned no session. Disable 'Confirm email' in Supabase Auth.");
			return { status: "error", error: new Error("登録を完了できませんでした。") };
		}

		return { status: "created", userId: data.user.id };
	}

	async signOut(): Promise<void> {
		await supabase.auth.signOut();
	}
}
