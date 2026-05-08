import type { Employee } from "../entities/Employee";

export interface EmployeeRepository {
	findCurrentEmployeeId(): Promise<{ data: number | null; error: Error | null }>;
	findById(employeeId: number): Promise<Employee | null>;
	findByEmployeeNo(employeeNo: string): Promise<Employee | null>;
	findSubordinateIds(employeeId: number): Promise<number[]>;
	findEvaluatorNames(
		primaryEvaluatorId: number | null,
		secondaryEvaluatorId: number | null,
	): Promise<{
		primaryEvaluator: string;
		secondaryEvaluator: string;
	}>;
	findGradeName(gradeId: number | null): Promise<string>;
	linkUserToEmployee(employeeNo: string, authUserId: string): Promise<boolean>;
	checkUserLinked(employeeNo: string): Promise<boolean>;
}
