import type {
	EmployeeRepository,
	RegistrationStart,
} from "../../domain/repositories/EmployeeRepository";
import { supabase } from "../db/supabase";

export class SupabaseEmployeeRepository implements EmployeeRepository {
	async findCurrentAccessState(): ReturnType<EmployeeRepository["findCurrentAccessState"]> {
		const { data, error } = await supabase.rpc("get_current_employee_access_state");
		return !error &&
			(data === "enabled" || data === "disabled" || data === "password_change_required")
			? data
			: "unregistered";
	}

	/** ログイン中のアカウントと、その社員ID。同じアカウントの間は問い合わせ直さない。 */
	private current?: { userId: string; employeeId: Promise<number | null> };
	/** 等級名。評価シートを開くたびに引かれるが、ほとんど変わらないので一度だけ読む。 */
	private gradeNames?: Promise<Map<number, string>>;

	async checkUserLinked(_authUserId: string): Promise<boolean> {
		// 読めなかったことを「紐付いていない(登録が終わっていない)」と言わない
		return (await this.findEmployeeId()) !== null;
	}

	async findKeepSignedIn(authUserId: string): Promise<boolean> {
		// ログイン状態の保持は表から読めない。employee_details は本人の分を必ず返す
		const { data, error } = await supabase
			.rpc("employee_details")
			.eq("user_id", authUserId)
			.maybeSingle();

		// 読めないときは、保持しない
		return !error && (data as { keep_signed_in?: boolean } | null)?.keep_signed_in === true;
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
				this.current = { userId, employeeId: this.findEmployeeId() };
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

	/** ログイン中のアカウントに紐付く、利用中の社員。user_id は表から読めないので、DB が JWT から引く。 */
	private async findEmployeeId(): Promise<number | null> {
		const { data, error } = await supabase.rpc("current_employee_id");
		if (error) {
			throw error;
		}
		return typeof data === "number" ? data : null;
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

	async beginRegistration(employeeNo: string, invitationCode = ""): Promise<RegistrationStart> {
		const { data, error } = await supabase.rpc("begin_registration", {
			p_employee_no: employeeNo,
			p_invitation_code: invitationCode,
		});
		if (error) {
			throw error;
		}
		const start = data as { status?: string; token?: string } | null;
		if (start?.status === "available" && typeof start.token === "string") {
			return { status: "available", token: start.token };
		}
		return {
			status:
				start?.status === "registered"
					? "registered"
					: start?.status === "missing"
						? "missing"
						: "invalid_invitation",
		};
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
