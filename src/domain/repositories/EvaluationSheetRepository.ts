import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import type { EvaluationRank } from "../valueObjects/EvaluationRank";
import type { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import type { EvaluationStatus } from "../valueObjects/EvaluationStatus";

export interface EvaluationSheetSummary {
	id: number;
	periodId: number;
	employeeId: number;
	status: string;
	totalScore: number;
	createdAt: string;
	updatedAt: string;
	periodName: string;
	periodStart: string;
	periodEnd: string;
	employeeName: string;
	employeeNo: string;
	/** シートを作成したときの等級。等級が未設定だった場合は空文字。 */
	gradeName: string;
}

export interface EvaluationSheetExportData {
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	careerCourse: string;
	gradeName: string;
	periodName: string;
	periodStart: string;
	periodEnd: string;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	/** true の場合(二次評価者「なし」)、一次評価者が最終評価者を兼ね、一次評価がそのまま最終評価になる。 */
	primaryIsFinalEvaluator: boolean;
	status: string;
	totalScore: number;
	finalEvaluationRank: string;
	objectiveAllocationScore: number;
	objectiveSecondRate: number;
	objectiveEvaluationScore: number;
	commonEvaluationAllocationScore: number;
	commonEvaluationSecondRate: number;
	commonEvaluationEvaluationScore: number;
	totalEvaluationScore: number;
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: {
		id: number;
		goalNumber: number;
		challengeGoal: string;
		midtermGoal: string;
		achievement: string;
		selfScore: number | null;
		evaluatorScore: number | null;
	}[];
	commonEvaluations: {
		itemName: string;
		itemDescription: string;
		weight: number;
		selfScore: number | null;
		evaluatorScore: number | null;
		selfComment: string | null;
		evaluatorComment: string | null;
	}[];
}

export interface EvaluationSheetRepository {
	findById(sheetId: number): Promise<EvaluationSheet | null>;
	createOrGetSheet(periodId: number, employeeId: number): Promise<number>;
	updateScoreTotals(
		sheetId: number,
		totals: {
			objectives?: EvaluationScoreTotals;
			commonEvaluationResults?: EvaluationScoreTotals;
			allocatedScores?: EvaluationAllocatedScores;
		},
	): Promise<void>;
	updateOverallComment(
		sheetId: number,
		target: "first" | "second",
		comment: string,
	): Promise<EvaluationSheet>;
	/** ranks: 状態と同時に保存する、確定した評価ランク(一次評価の確定・評価の確定のとき)。 */
	updateStatus(
		sheetId: number,
		status: EvaluationStatus,
		ranks?: { first?: EvaluationRank; final?: EvaluationRank },
	): Promise<EvaluationSheet>;
	findByOwner(employeeId: number): Promise<EvaluationSheetSummary[]>;
	findByEmployeeIds(employeeIds: number[]): Promise<EvaluationSheetSummary[]>;
	findExportData(sheetId: number): Promise<EvaluationSheetExportData | null>;
}
