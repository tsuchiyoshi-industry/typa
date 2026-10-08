import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import type { EvaluationRank } from "../valueObjects/EvaluationRank";
import type { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import type { EvaluationStatus } from "../valueObjects/EvaluationStatus";

export interface EvaluationSheetSummary {
	id: number;
	periodId: number;
	employeeId: number;
	status: EvaluationStatus;
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
}
