import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type {
	EmployeeGrade,
	EmployeeInvitation,
	EmployeeMasterRepository,
	EvaluatorType,
	NewEmployee,
} from "../../domain/repositories/EmployeeMasterRepository";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { supabase } from "../db/supabase";

/** 社員の行のうち、行を見られる人なら誰でも読める列。 */
interface EmployeeRow {
	id: number;
	name: string;
	employee_no: string;
	career_course: string | null;
	primary_evaluator_id: number | null;
	secondary_evaluator_id: number | null;
	no_secondary_evaluator: boolean | null;
}

const EMPLOYEE_COLUMNS =
	"id, name, employee_no, career_course, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator";

/**
 * 見る人を限る項目(ドメインの canViewEmployeeDetail)。表からは読めず、DB 関数 employee_details が
 * 同じ判定で、見てよい分だけを返す。見られない項目は null。
 */
interface EmployeeDetailRow {
	employee_id: number;
	grade_id: number | null;
	role_name: string | null;
	keep_signed_in: boolean | null;
	registered: boolean | null;
	enabled: boolean | null;
}

/** 更新できる列。等級とログイン状態の保持は、Admin が表を直接更新する(読めなくても書ける)。 */
type EmployeeUpdate = Partial<{
	grade_id: number;
	keep_signed_in: boolean;
	primary_evaluator_id: number | null;
	secondary_evaluator_id: number | null;
	no_secondary_evaluator: boolean;
}>;

interface GradeRow {
	id: number;
	grade_name: string;
}

export class SupabaseEmployeeMasterRepository implements EmployeeMasterRepository {
	/**
	 * ログイン中の社員。画面の出し分けと操作前の確認のたびに引かれるので、同じアカウントの間は覚えておく。
	 * 権限が変わっても古い表示が残るだけで、操作してよいかは DB が毎回確かめる。
	 */
	private current?: { userId: string; profile: Promise<EmployeeProfile | null>; expiresAt: number };

	async findCurrentEmployeeProfile(): Promise<EmployeeProfile | null> {
		// 手元のセッションを読むだけで、通信しない
		const {
			data: { session },
			error,
		} = await supabase.auth.getSession();

		if (error || !session) {
			this.current = undefined;
			return null;
		}

		const userId = session.user.id;
		if (this.current?.userId !== userId || this.current.expiresAt <= Date.now()) {
			this.current = {
				userId,
				profile: this.findOwnProfile(),
				expiresAt: Date.now() + 30_000,
			};
		}
		const lookup = this.current;
		const profile = await lookup.profile.catch(() => null);
		// 見つからなかった(登録の途中・読み込みの失敗)という結果は、覚えておかない
		if (profile === null && this.current === lookup) {
			this.current = undefined;
		}
		return profile;
	}

	private async findOwnProfile(): Promise<EmployeeProfile | null> {
		const currentEmployeeId = await this.findCurrentEmployeeId();
		if (currentEmployeeId == null) {
			return null;
		}

		const profiles = await this.findProfiles();
		return profiles.find((profile) => profile.id === currentEmployeeId) ?? null;
	}

	async findAllEmployeeProfiles(): Promise<EmployeeProfile[]> {
		return this.findProfiles();
	}

	async findByEmployeeNo(employeeNo: string): Promise<EmployeeProfile | null> {
		const profiles = await this.findProfiles();
		return profiles.find((profile) => profile.employeeNo === employeeNo) ?? null;
	}

	async findGrades(): Promise<EmployeeGrade[]> {
		const { data, error } = await supabase
			.from("employee_grades")
			.select("id, grade_name")
			.order("id");

		// 読めなかった等級を「選べる等級が無い」と見せない
		if (error || !data) {
			throw error ?? new Error("等級を読み込めませんでした。");
		}

		return (data as GradeRow[]).map((grade) => ({ id: grade.id, name: grade.grade_name }));
	}

	async updateEvaluatorByEmployeeNo(
		targetEmployeeNo: string,
		evaluatorEmployeeNo: string | null,
		evaluatorType: EvaluatorType,
	): Promise<EmployeeProfile | null> {
		const evaluator =
			evaluatorEmployeeNo === null ? null : await this.findByEmployeeNo(evaluatorEmployeeNo);
		if (evaluatorEmployeeNo !== null && !evaluator) {
			return null;
		}

		return this.updateEmployee(
			targetEmployeeNo,
			evaluatorType === "primary"
				? { primary_evaluator_id: evaluator?.id ?? null }
				: // 評価者を外すときは「なし」と明示して保存し、未設定(指定待ち)と区別する
					{
						secondary_evaluator_id: evaluator?.id ?? null,
						no_secondary_evaluator: evaluator === null,
					},
		);
	}

	async updateGradeByEmployeeNo(
		targetEmployeeNo: string,
		gradeId: number,
	): Promise<EmployeeProfile | null> {
		return this.updateEmployee(targetEmployeeNo, { grade_id: gradeId });
	}

	async updateKeepSignedInByEmployeeNo(
		targetEmployeeNo: string,
		keepSignedIn: boolean,
	): Promise<EmployeeProfile | null> {
		return this.updateEmployee(targetEmployeeNo, { keep_signed_in: keepSignedIn });
	}

	async updateRoleByEmployeeNo(targetEmployeeNo: string, role: EmployeeRole): Promise<boolean> {
		// role_id はクライアントから直接更新できない。Admin の確認と「Admin を0人にしない」をDB関数に任せる
		const { data, error } = await supabase.rpc("set_employee_role", {
			p_employee_no: targetEmployeeNo,
			p_role_name: role.toString(),
		});

		if (error) {
			console.error("Error updating employee role:", error);
			return false;
		}

		// 自分の権限を変えたかもしれない
		this.current = undefined;
		return data === true;
	}

	async resetRegistrationByEmployeeNo(targetEmployeeNo: string): Promise<boolean> {
		// Authユーザーの削除はクライアントの権限ではできないため、Admin だけが実行できるDB関数に任せる
		const { data, error } = await supabase.rpc("reset_employee_registration", {
			p_employee_no: targetEmployeeNo,
		});

		if (error) {
			console.error("Error resetting employee registration:", error);
			return false;
		}

		return data === true;
	}

	async resetPasswordByEmployeeNo(targetEmployeeNo: string, password: string): Promise<boolean> {
		// Auth のパスワード・セッション・監査を、DB 関数が1つのトランザクションで変える
		const { error } = await supabase.rpc("reset_employee_password", {
			p_employee_no: targetEmployeeNo,
			p_password: password,
		});
		if (error) {
			// 理由(権限・状態・条件)だけを残す。入力は残さない
			console.error("Error resetting employee password:", error.code, error.message);
			return false;
		}
		return true;
	}

	async issueInvitationByEmployeeNo(targetEmployeeNo: string): Promise<EmployeeInvitation | null> {
		// コードは DB 関数が作り、平文はこの応答で一度だけ返る。Admin の確認も DB 関数に任せる
		const { data, error } = await supabase.rpc("issue_employee_invitation", {
			p_employee_no: targetEmployeeNo,
		});

		if (error || typeof data?.code !== "string" || typeof data?.expiresAt !== "string") {
			console.error("Error issuing employee invitation:", error);
			return null;
		}

		return { code: data.code, expiresAt: data.expiresAt };
	}

	async issuePendingInvitations(
		includeIssued = false,
	): Promise<(EmployeeInvitation & { employeeNo: string; name: string })[] | null> {
		// 全員分を1往復で発行する。対象の選び方と Admin の確認は DB 関数に任せる
		const { data, error } = await supabase.rpc("issue_pending_employee_invitations", {
			p_include_issued: includeIssued,
		});

		if (error || !Array.isArray(data)) {
			console.error("Error issuing pending employee invitations:", error);
			return null;
		}

		return data;
	}

	async updateEnabledByEmployeeNo(targetEmployeeNo: string, enabled: boolean): Promise<boolean> {
		// is_enabled はクライアントから直接更新できない。Admin の確認と「Admin を0人にしない」をDB関数に任せる
		const { data, error } = await supabase.rpc("set_employee_enabled", {
			p_employee_no: targetEmployeeNo,
			p_enabled: enabled,
		});

		if (error) {
			console.error("Error updating employee enabled:", error);
			return false;
		}

		// 自分の利用状態を変えたかもしれない
		this.current = undefined;
		return data === true;
	}

	async preRegisterEmployee(employee: NewEmployee): Promise<boolean> {
		// employees はクライアントから行を足せない。Admin の確認と番号の重なりの確認を DB 関数に任せる
		const { data, error } = await supabase.rpc("pre_register_employee", {
			p_employee_no: employee.employeeNo,
			p_name: employee.name,
			p_grade_id: employee.gradeId,
			p_career_course: employee.careerCourse,
			p_primary_evaluator_no: employee.primaryEvaluatorEmployeeNo,
			p_secondary_evaluator_no: employee.secondaryEvaluatorEmployeeNo,
			p_no_secondary_evaluator: employee.noSecondaryEvaluator,
		});

		if (error) {
			console.error("Error pre-registering employee:", error);
			return false;
		}

		return data === true;
	}

	private async updateEmployee(
		targetEmployeeNo: string,
		values: EmployeeUpdate,
	): Promise<EmployeeProfile | null> {
		const { data, error } = await supabase
			.from("employees")
			.update(values)
			.eq("employee_no", targetEmployeeNo)
			.select("id");

		// RLSで拒否された更新はエラーにならず0件で返るため、更新できた行があることも確かめる
		if (error || !data?.length) {
			console.error("Error updating employee:", error);
			return null;
		}
		// 自分の評価者・等級を変えたかもしれない
		this.current = undefined;

		return this.findByEmployeeNo(targetEmployeeNo);
	}

	private async findCurrentEmployeeId(): Promise<number | null> {
		// user_id は表から読めない(絞り込みにも使えない)。ログイン中の社員は DB が JWT から引く
		const { data, error } = await supabase.rpc("current_employee_id");
		if (error || typeof data !== "number") {
			return null;
		}
		return data;
	}

	private async findProfiles(): Promise<EmployeeProfile[]> {
		const [employeesResult, detailsResult, gradesResult] = await Promise.all([
			supabase.from("employees").select(EMPLOYEE_COLUMNS).order("employee_no"),
			supabase.rpc("employee_details"),
			supabase.from("employee_grades").select("id, grade_name"),
		]);

		// どれかが読めなければ失敗にする。読めなかったことを「社員がいない」「全員 Employee」
		// 「全員の等級が未設定」と見せない
		for (const result of [employeesResult, detailsResult, gradesResult]) {
			if (result.error || !result.data) {
				throw result.error ?? new Error("社員マスタを読み込めませんでした。");
			}
		}

		const employees = employeesResult.data as unknown as EmployeeRow[];
		const details = new Map(
			(detailsResult.data as EmployeeDetailRow[]).map((row) => [row.employee_id, row]),
		);
		const grades = gradesResult.data as GradeRow[];
		const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
		const gradeNames = new Map(grades.map((grade) => [grade.id, grade.grade_name]));

		return employees.map((employee) => {
			// 見られない項目は、いちばん弱い値(Employee・未設定・未登録)で埋める。
			// 画面に出すかどうかは、ユースケースがドメインの canViewEmployeeDetail で決める
			const detail = details.get(employee.id);
			const gradeId = detail?.grade_id ?? null;
			return new EmployeeProfile(
				employee.id,
				employee.name,
				employee.employee_no,
				null,
				// DB は権限を名前(文字列)で持つ。アプリの中では値オブジェクトで扱う
				EmployeeRole.fromStored(detail?.role_name),
				employee.career_course,
				gradeId,
				gradeId ? (gradeNames.get(gradeId) ?? "未設定") : "未設定",
				employee.primary_evaluator_id,
				employee.primary_evaluator_id
					? (employeeNames.get(employee.primary_evaluator_id) ?? "未設定")
					: "未設定",
				employee.secondary_evaluator_id,
				// 「なし」と明示された社員と、未設定(指定待ち)の社員を区別して表示する
				employee.secondary_evaluator_id
					? (employeeNames.get(employee.secondary_evaluator_id) ?? "未設定")
					: employee.no_secondary_evaluator
						? "なし"
						: "未設定",
				employee.no_secondary_evaluator ?? false,
				detail?.registered ?? false,
				detail?.keep_signed_in ?? false,
				detail?.enabled ?? true,
			);
		});
	}
}
