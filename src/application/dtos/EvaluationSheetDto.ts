import type { EmployeeDto } from "./EmployeeDto";
import type { EvaluationPeriodDto } from "./EvaluationPeriodDto";
import type { MilestoneDto } from "./MilestoneDto";

export interface EvaluationScoreTotalsDto {
	firstTotalScore: number;
	firstTotalRate: number;
	secondTotalScore: number;
	secondTotalRate: number;
}

export interface EvaluationAllocatedScoresDto {
	objectiveAllocationScore: number;
	objectiveSecondRate: number;
	objectiveEvaluationScore: number;
	commonEvaluationAllocationScore: number;
	commonEvaluationSecondRate: number;
	commonEvaluationEvaluationScore: number;
	totalEvaluationScore: number;
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
	finalEvaluationRank?: FinalEvaluationRankDto;
}
