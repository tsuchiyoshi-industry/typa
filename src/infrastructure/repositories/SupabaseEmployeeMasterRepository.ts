import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type {
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

	async findSubordinateProfiles(evaluatorEmployeeId: number): Promise<EmployeeProfile[]> {
		const profiles = await this.findProfiles();
		return profiles.filter(
			(profile) =>
				profile.primaryEvaluatorId === evaluatorEmployeeId ||
				profile.secondaryEvaluatorId === evaluatorEmployeeId,
		);
	}

	async findByEmployeeNo(employeeNo: string): Promise<EmployeeProfile | null> {
		const profiles = await this.findProfiles();
		return profiles.find((profile) => profile.employeeNo === employeeNo) ?? null;
	}

	async assignEvaluatorByEmployeeNo(
		targetEmployeeNo: string,
		evaluatorEmployeeId: number,
		evaluatorType: EvaluatorType,
	): Promise<EmployeeProfile | null> {
		const columnName =
			evaluatorType === "primary" ? "primary_evaluator_id" : "secondary_evaluator_id";
		const { error } = await supabase
			.from("employees")
			.update({ [columnName]: evaluatorEmployeeId })
			.eq("employee_no", targetEmployeeNo);

		if (error) {
			console.error("Error assigning evaluator:", error);
			return null;
		}

		return this.findByEmployeeNo(targetEmployeeNo);
	}

	async updateEvaluatorByEmployeeNo(
		targetEmployeeNo: string,
		evaluatorEmployeeNo: string,
		evaluatorType: EvaluatorType,
	): Promise<EmployeeProfile | null> {
		const evaluator = await this.findByEmployeeNo(evaluatorEmployeeNo);
		if (!evaluator) {
			return null;
		}

		return this.assignEvaluatorByEmployeeNo(targetEmployeeNo, evaluator.id, evaluatorType);
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
					employee.secondary_evaluator_id
						? (employeeNames.get(employee.secondary_evaluator_id) ?? "未設定")
						: "未設定",
				),
		);
	}
}
