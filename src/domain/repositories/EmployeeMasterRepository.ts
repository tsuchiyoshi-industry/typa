import type { EmployeeProfile } from "../entities/EmployeeProfile";

export type EvaluatorType = "primary" | "secondary";

export interface EmployeeMasterRepository {
	findCurrentEmployeeProfile(): Promise<EmployeeProfile | null>;
	findAllEmployeeProfiles(): Promise<EmployeeProfile[]>;
	findSubordinateProfiles(evaluatorEmployeeId: number): Promise<EmployeeProfile[]>;
	findByEmployeeNo(employeeNo: string): Promise<EmployeeProfile | null>;
	assignEvaluatorByEmployeeNo(
		targetEmployeeNo: string,
		evaluatorEmployeeId: number,
		evaluatorType: EvaluatorType,
	): Promise<EmployeeProfile | null>;
	updateEvaluatorByEmployeeNo(
		targetEmployeeNo: string,
		evaluatorEmployeeNo: string,
		evaluatorType: EvaluatorType,
	): Promise<EmployeeProfile | null>;
}
