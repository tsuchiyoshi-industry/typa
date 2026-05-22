import type { EvaluatorType } from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterMode } from "../../domain/services/EmployeeMasterAccessService";

export interface EmployeeProfileDto {
	id: number;
	name: string;
	employeeNo: string;
	roleName: string;
	careerCourse: string | null;
	gradeName: string;
	primaryEvaluatorName: string;
	secondaryEvaluatorName: string;
}

export interface ApprovalRelationDto {
	employeeId: number;
	name: string;
	employeeNo: string;
	gradeName: string;
	primaryEvaluatorName: string;
	secondaryEvaluatorName: string;
}

export interface EmployeeMasterDto {
	currentEmployee: EmployeeProfileDto | null;
	mode: EmployeeMasterMode;
	canAssignEvaluators: boolean;
	canViewAllRelations: boolean;
	relations: ApprovalRelationDto[];
}

export interface AssignEvaluatorResultDto {
	success: boolean;
	message: string;
	evaluatorType: EvaluatorType;
	targetEmployeeNo: string;
}
