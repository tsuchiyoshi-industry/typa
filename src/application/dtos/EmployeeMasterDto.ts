import type {
	EmployeeGrade,
	EvaluatorType,
} from "../../domain/repositories/EmployeeMasterRepository";
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
	gradeId: number | null;
	gradeName: string;
	primaryEvaluatorId: number | null;
	primaryEvaluatorName: string;
	secondaryEvaluatorId: number | null;
	secondaryEvaluatorName: string;
	/** 二次評価者を「なし」と明示しているか。false で secondaryEvaluatorId が null なら未設定(指定待ち)。 */
	noSecondaryEvaluator: boolean;
}

export interface EmployeeMasterDto {
	currentEmployee: EmployeeProfileDto | null;
	mode: EmployeeMasterMode;
	canEditEvaluators: boolean;
	canEditGrades: boolean;
	relations: ApprovalRelationDto[];
	grades: EmployeeGrade[];
}

export interface AssignEvaluatorResultDto {
	success: boolean;
	message: string;
	evaluatorType: EvaluatorType;
	targetEmployeeNo: string;
}
