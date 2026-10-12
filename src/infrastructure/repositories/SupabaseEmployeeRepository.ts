import type {
	EmployeeRepository,
	RegistrationStart,
} from "../../domain/repositories/EmployeeRepository";
import { supabase } from "../db/supabase";

export class SupabaseEmployeeRepository implements EmployeeRepository {
	/** ログイン中のアカウントと、その社員ID。同じアカウントの間は問い合わせ直さない。 */
	private current?: { userId: string; employeeId: Promise<number | null> };
	/** 等級名。評価シートを開くたびに引かれるが、ほとんど変わらないので一度だけ読む。 */
	private gradeNames?: Promise<Map<number, string>>;

	async checkUserLinked(authUserId: string): Promise<boolean> {
		const { data, error } = await supabase
			.from("employees")
			.select("id")
			.eq("user_id", authUserId)
			.maybeSingle();

		if (error) {
			console.error("Error checking user link:", error);
			return false;
		}

		// データが存在すれば紐づけ済み
		return !!data;
	}

	async findCurrentEmployeeId(): Promise<{ data: number | null; error: Error | null }> {
		try {
			// 手元のセッションを読むだけで、通信しない。誰の操作かは、どの問い合わせでも DB が確かめる
			const {
				data: { session },
				error: authError,
			} = await supabase.auth.getSession();

			if (authError) {
				throw authError;
			}
			if (!session) {
				this.current = undefined;
				return { data: null, error: null };
			}

			const userId = session.user.id;
			if (this.current?.userId !== userId) {
				this.current = { userId, employeeId: this.findEmployeeId(userId) };
			}
			const lookup = this.current;
			try {
				const employeeId = await lookup.employeeId;
				// まだ紐付いていない(登録の途中)という結果は、覚えておかない
				if (employeeId === null && this.current === lookup) {
					this.current = undefined;
				}
				return { data: employeeId, error: null };
			} catch (e) {
				if (this.current === lookup) {
					this.current = undefined;
				}
				throw e;
			}
		} catch (e) {
			return {
				data: null,
				error: e instanceof Error ? e : new Error(String(e)),
			};
		}
	}

	private async findEmployeeId(userId: string): Promise<number | null> {
		const { data, error } = await supabase
			.from("employees")
			.select("id")
			.eq("user_id", userId)
			.maybeSingle();

		if (error) {
			throw error;
		}
		return data ? (data as { id: number }).id : null;
	}

	async findGradeName(gradeId: number | null): Promise<string> {
		if (gradeId == null) {
			return "未設定";
		}

		this.gradeNames ??= this.findGradeNames();
		const pending = this.gradeNames;
		try {
			return (await pending).get(gradeId) ?? "未設定";
		} catch {
			// 読めなかった結果は覚えておかず、次に引かれたときに読み直す
			if (this.gradeNames === pending) {
				this.gradeNames = undefined;
			}
			return "未設定";
		}
	}

	private async findGradeNames(): Promise<Map<number, string>> {
		const { data, error } = await supabase.from("employee_grades").select("id, grade_name");
		if (error || !data) {
			throw error ?? new Error("Failed to load grades.");
		}
		return new Map(
			(data as { id: number; grade_name: string }[]).map((grade) => [grade.id, grade.grade_name]),
		);
	}

	async beginRegistration(employeeNo: string): Promise<RegistrationStart> {
		const { data, error } = await supabase.rpc("begin_registration", {
			p_employee_no: employeeNo,
		});
		if (error) {
			throw error;
		}
		const start = data as { status?: string; token?: string } | null;
		if (start?.status === "available" && typeof start.token === "string") {
			return { status: "available", token: start.token };
		}
		return { status: start?.status === "registered" ? "registered" : "missing" };
	}

	async completeRegistration(token: string): Promise<boolean> {
		const { data, error } = await supabase.rpc("complete_registration", { p_token: token });
		if (!error && data === true) {
			// 紐付いた社員IDを、次の操作で読み直す
			this.current = undefined;
			return true;
		}
		return false;
	}
}
