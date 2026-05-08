import type { Employee } from "../entities/Employee";

export function isPrimaryEvaluator(currentEmployeeId: number, employee: Employee): boolean {
	return (
		currentEmployeeId !== null &&
		employee.primaryEvaluatorId !== null &&
		currentEmployeeId === employee.primaryEvaluatorId
	);
}

export function isSecondaryEvaluator(currentEmployeeId: number, employee: Employee): boolean {
	return (
		currentEmployeeId !== null &&
		employee.secondaryEvaluatorId !== null &&
		currentEmployeeId === employee.secondaryEvaluatorId
	);
}
