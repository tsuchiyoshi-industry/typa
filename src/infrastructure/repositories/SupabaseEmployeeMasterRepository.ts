import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type {
	EmployeeGrade,
	EmployeeMasterRepository,
	EvaluatorType,
} from "../../domain/repositories/EmployeeMasterRepository";
import { supabase } from "../db/supabase";

interface EmployeeRow {
	id: number;
	user_id: string | null;
	name: string;
	employee_no: string;
	role_id: number | null;
	career_course: string | null;
	grade_id: number | null;
	primary_evaluator_id: number | null;
	secondary_evaluator_id: number | null;
	no_secondary_evaluator?: boolean | null;
}

interface RoleRow {
	id: number;
	role_name: string;
}

interface GradeRow {
	id: number;
	grade_name: string;
}

export class SupabaseEmployeeMasterRepository implements EmployeeMasterRepository {
	async findCurrentEmployeeProfile(): Promise<EmployeeProfile | null> {
		const {
			data: { user },
			error,
		} = await supabase.auth.getUser();

		if (error || !user) {
			return null;
		}

		const currentEmployeeId = await this.findEmployeeIdByUserId(user.id);
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

		if (error || !data) {
			console.error("Error loading grades:", error);
			return [];
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

	private async updateEmployee(
		targetEmployeeNo: string,
		values: Partial<EmployeeRow>,
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

		return this.findByEmployeeNo(targetEmployeeNo);
	}

	private async findEmployeeIdByUserId(userId: string): Promise<number | null> {
		const { data, error } = await supabase
			.from("employees")
			.select("id")
			.eq("user_id", userId)
			.maybeSingle();

		if (error || !data) {
			return null;
		}

		return (data as { id: number }).id;
	}

	private async findProfiles(): Promise<EmployeeProfile[]> {
		const [employeesResult, rolesResult, gradesResult] = await Promise.all([
			supabase.from("employees").select("*").order("employee_no"),
			supabase.from("roles").select("id, role_name"),
			supabase.from("employee_grades").select("id, grade_name"),
		]);

		if (employeesResult.error || !employeesResult.data) {
			console.error("Error loading employees:", employeesResult.error);
			return [];
		}

		const employees = employeesResult.data as EmployeeRow[];
		const roles = (rolesResult.data ?? []) as RoleRow[];
		const grades = (gradesResult.data ?? []) as GradeRow[];
		const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
		const roleNames = new Map(roles.map((role) => [role.id, role.role_name]));
		const gradeNames = new Map(grades.map((grade) => [grade.id, grade.grade_name]));

		return employees.map(
			(employee) =>
				new EmployeeProfile(
					employee.id,
					employee.name,
					employee.employee_no,
					employee.role_id,
					employee.role_id ? (roleNames.get(employee.role_id) ?? "Employee") : "Employee",
					employee.career_course,
					employee.grade_id,
					employee.grade_id ? (gradeNames.get(employee.grade_id) ?? "未設定") : "未設定",
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
				),
		);
	}
}
