import type { Employee } from "../entities/Employee";

export interface EmployeeRepository {
	findCurrentEmployeeId(): Promise<number | null>;
	findById(employeeId: number): Promise<Employee | null>;
	findSubordinateIds(employeeId: number): Promise<number[]>;
	findEvaluatorNames(
		primaryEvaluatorId: number | null,
		secondaryEvaluatorId: number | null,
	): Promise<{
		primaryEvaluator: string;
		secondaryEvaluator: string;
	}>;
	findGradeName(gradeId: number | null): Promise<string>;
}
