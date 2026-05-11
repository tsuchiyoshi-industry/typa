import { Employee } from "../../domain/entities/Employee";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import { supabase } from "../db/supabase";

export class SupabaseEmployeeRepository implements EmployeeRepository {
	async findCurrentEmployeeId(): Promise<number | null> {
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (!user) {
			return null;
		}

		const { data, error } = await supabase
			.from("employees")
			.select("id")
			.eq("user_id", user.id)
			.maybeSingle();

		if (error || !data) {
			return null;
		}

		return (data as { id: number }).id;
	}

	async findById(employeeId: number): Promise<Employee | null> {
		const { data, error } = await supabase
			.from("employees")
			.select("*")
			.eq("id", employeeId)
			.maybeSingle();

		if (error || !data) {
			return null;
		}

		const employee = data as {
			id: number;
			name: string;
			employee_no: string;
			role_id: number;
			career_course: string | null;
			grade_id: number | null;
			primary_evaluator_id: number | null;
			secondary_evaluator_id: number | null;
		};

		return new Employee(
			employee.id,
			employee.name,
			employee.employee_no,
			employee.role_id,
			employee.career_course,
			employee.grade_id,
			employee.primary_evaluator_id,
			employee.secondary_evaluator_id,
		);
	}

	async findSubordinateIds(employeeId: number): Promise<number[]> {
		const { data, error } = await supabase
			.from("employees")
			.select("id")
			.or(`primary_evaluator_id.eq.${employeeId},secondary_evaluator_id.eq.${employeeId}`)
			.neq("id", employeeId);

		if (error || !data) {
			return [];
		}

		return (data as Array<{ id: number }>).map((employee) => employee.id);
	}

	async findEvaluatorNames(
		primaryEvaluatorId: number | null,
		secondaryEvaluatorId: number | null,
	): Promise<{ primaryEvaluator: string; secondaryEvaluator: string }> {
		if (!primaryEvaluatorId && !secondaryEvaluatorId) {
			return {
				primaryEvaluator: "未設定",
				secondaryEvaluator: "未設定",
			};
		}

		const ids = [primaryEvaluatorId, secondaryEvaluatorId].filter(
			(id): id is number => id !== null,
		);
		const { data, error } = await supabase.from("employees").select("id, name").in("id", ids);

		if (error || !data) {
			return {
				primaryEvaluator: "未設定",
				secondaryEvaluator: "未設定",
			};
		}

		const employees = data as Array<{ id: number; name: string }>;
		const names = new Map<number, string>(employees.map((item) => [item.id, item.name]));

		return {
			primaryEvaluator: primaryEvaluatorId ? (names.get(primaryEvaluatorId) ?? "未設定") : "未設定",
			secondaryEvaluator: secondaryEvaluatorId
				? (names.get(secondaryEvaluatorId) ?? "未設定")
				: "未設定",
		};
	}

	async findGradeName(gradeId: number | null): Promise<string> {
		if (gradeId == null) {
			return "未設定";
		}

		const { data, error } = await supabase
			.from("employee_grades")
			.select("grade_name")
			.eq("id", gradeId)
			.maybeSingle();

		if (error || !data) {
			return "未設定";
		}

		return (data as { grade_name: string }).grade_name;
	}
}
