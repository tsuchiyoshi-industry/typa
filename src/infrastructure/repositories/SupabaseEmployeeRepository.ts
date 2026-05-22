import { Employee } from "../../domain/entities/Employee";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import { supabase } from "../db/supabase";

export class SupabaseEmployeeRepository implements EmployeeRepository {
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
			const {
				data: { user },
				error: authError,
			} = await supabase.auth.getUser();

			if (authError) {
				throw authError;
			}
			if (!user) {
				return { data: null, error: null };
			}

			const { data, error: dbError } = await supabase
				.from("employees")
				.select("id")
				.eq("user_id", user.id)
				.maybeSingle();

			if (dbError) {
				throw dbError;
			}

			return {
				data: data ? (data as { id: number }).id : null,
				error: null,
			};
		} catch (e) {
			return {
				data: null,
				error: e instanceof Error ? e : new Error(String(e)),
			};
		}
	}

	// 引数で userId (AuthのUID) を直接受け取る
	async findEmployeeIdByAuthId(
		authUserId: string,
	): Promise<{ data: number | null; error: Error | null }> {
		try {
			const { data, error } = await supabase
				.from("employees")
				.select("id")
				.eq("user_id", authUserId)
				.maybeSingle();

			if (error) {
				throw error;
			}
			return { data: data ? (data as { id: number }).id : null, error: null };
		} catch (e) {
			return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
		}
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

	async findByEmployeeNo(employeeNo: string): Promise<Employee | null> {
		const { data, error } = await supabase
			.from("employees")
			.select("*")
			.eq("employee_no", employeeNo)
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

	async linkUserToEmployee(employeeNo: string, authUserId: string): Promise<boolean> {
		const { data, error } = await supabase
			.from("employees")
			.update({ user_id: authUserId })
			.eq("employee_no", employeeNo)
			.is("user_id", null)
			.select("id")
			.maybeSingle();

		return !error && !!data;
	}
}
