import type { EmployeeDto } from "./EmployeeDto";
import type { EvaluationPeriodDto } from "./EvaluationPeriodDto";
import type { MilestoneDto } from "./MilestoneDto";

export interface EvaluationScoreTotalsDto {
	firstTotalScore: number | null;
	firstTotalRate: number | null;
	secondTotalScore: number | null;
	secondTotalRate: number | null;
}

export interface EvaluationAllocatedScoresDto {
	objectiveAllocationScore: number;
	objectiveSecondRate: number | null;
	objectiveEvaluationScore: number | null;
	commonEvaluationAllocationScore: number;
	commonEvaluationSecondRate: number | null;
	commonEvaluationEvaluationScore: number | null;
	totalEvaluationScore: number | null;
}

export interface FinalEvaluationRankDto {
	letter: string;
	level: string;
	displayText: string;
}

export interface EvaluationSheetDto {
	sheetId: number;
	subject: EmployeeDto | null;
	evaluationPeriod: EvaluationPeriodDto | null;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: MilestoneDto[];
	objectiveScoreTotals: EvaluationScoreTotalsDto;
	commonEvaluationScoreTotals: EvaluationScoreTotalsDto;
	allocatedScores: EvaluationAllocatedScoresDto;
	status: string;
	isEditable: boolean;
	finalEvaluationRank?: FinalEvaluationRankDto;
}
