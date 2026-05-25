import type { EmployeeDto } from "./EmployeeDto";
import type { EvaluationPeriodDto } from "./EvaluationPeriodDto";
import type { MilestoneDto } from "./MilestoneDto";

export interface EvaluationSheetDto {
	sheetId: number;
	subject: EmployeeDto | null;
	evaluationPeriod: EvaluationPeriodDto | null;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: MilestoneDto[];
}
