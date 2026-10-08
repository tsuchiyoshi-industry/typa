import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
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

/** 評価ランク。得点率から機械的に決まる。confirmed: 確定して保存済みか(false は現在の点数からの見込み)。 */
export interface EvaluationRankDto {
	displayText: string;
	score: number;
	confirmed: boolean;
}

export interface EvaluationSheetDto {
	sheetId: number;
	subject: EmployeeDto | null;
	evaluationPeriod: EvaluationPeriodDto | null;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	/** 二次評価者「なし」の社員。一次評価者の確定がそのまま評価の確定になる。 */
	primaryIsFinalEvaluator: boolean;
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: MilestoneDto[];
	/** 1枚のシートに置けるチャレンジ目標の数の上限(設定値)。 */
	maxObjectives: number;
	objectiveScoreTotals: EvaluationScoreTotalsDto;
	commonEvaluationScoreTotals: EvaluationScoreTotalsDto;
	allocatedScores: EvaluationAllocatedScoresDto;
	status: EvaluationStatusValue;
	isEditable: boolean;
	/** 今このシートを確定できる評価者にだけ渡す、自分の評価の未設定項目。 */
	pendingEvaluationItems?: string[];
	/** 評価者にだけ見せる。本人には渡さない。 */
	firstEvaluationRank?: EvaluationRankDto;
	/** 最終評価者にだけ見せる。 */
	finalEvaluationRank?: EvaluationRankDto;
}
