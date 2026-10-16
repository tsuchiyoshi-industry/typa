import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
import type { CommonEvaluationSummaryDto } from "./CommonEvaluationDto";
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

/** まだ評価していない項目。目標なら goalNumber、共通評価なら itemId で、画面のどこにあるかを示す。 */
export interface PendingEvaluationItemDto {
	label: string;
	goalNumber?: number;
	itemId?: number;
}

/** 評価ランク。得点率から機械的に決まる。confirmed: 確定して保存済みか(false は現在の点数からの見込み)。 */
export interface EvaluationRankDto {
	displayText: string;
	score: number;
	confirmed: boolean;
}

/** そのシートで、見ている人に何ができるか。画面の出し分けに使う(保存の可否は DB 側でも確かめる)。 */
export interface SheetPermissionsDto {
	canResendNotification?: boolean;
	isSubject: boolean;
	canEditFirst: boolean;
	canEditSecond: boolean;
	canEditMilestoneGoal: boolean;
	canViewCommonEvaluation: boolean;
	canViewSecondEvaluation: boolean;
	canSubmitOwnSheet: boolean;
	canRevertOwnSheetToDraft: boolean;
	canConfirmFirstEvaluation: boolean;
	canFinalizeEvaluation: boolean;
}

export const NO_SHEET_PERMISSIONS: SheetPermissionsDto = {
	canResendNotification: false,
	isSubject: false,
	canEditFirst: false,
	canEditSecond: false,
	canEditMilestoneGoal: false,
	canViewCommonEvaluation: false,
	canViewSecondEvaluation: false,
	canSubmitOwnSheet: false,
	canRevertOwnSheetToDraft: false,
	canConfirmFirstEvaluation: false,
	canFinalizeEvaluation: false,
};

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
	/** 共通評価の項目と結果。評価者にだけ渡す(本人には null)。 */
	commonEvaluation: CommonEvaluationSummaryDto | null;
	objectiveScoreTotals: EvaluationScoreTotalsDto;
	commonEvaluationScoreTotals: EvaluationScoreTotalsDto;
	allocatedScores: EvaluationAllocatedScoresDto;
	status: EvaluationStatusValue;
	isEditable: boolean;
	/** シートと同じ読み込みで決める。シートと権限が食い違う間を作らない。 */
	permissions: SheetPermissionsDto;
	/** 今このシートを確定できる評価者にだけ渡す、自分の評価の未設定項目。 */
	pendingEvaluationItems?: PendingEvaluationItemDto[];
	/** 評価者にだけ見せる。本人には渡さない。 */
	firstEvaluationRank?: EvaluationRankDto;
	/** 最終評価者にだけ見せる。 */
	finalEvaluationRank?: EvaluationRankDto;
}
