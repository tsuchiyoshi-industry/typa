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

/**
 * 全社の評価シート一覧(Admin 向け)の1行。誰の・どの期間のシートが、どの段にあり、誰が評価し、
 * 確定していればどんな結果だったか。目標やコメントは、シートを開いて見る。
 */
export interface EvaluationSheetOverviewRow extends EvaluationSheetSummary {
	/** シートの評価者の名前。決まっていなければ「未設定」、二次評価者を置かないシートは「なし」。 */
	primaryEvaluatorName: string;
	secondaryEvaluatorName: string;
	/** 確定した評価点(100点満点)と最終評価ランク(「B+」のような表示)。確定前は null。 */
	finalScore: number | null;
	finalRank: string | null;
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
	/** シートの評価者(一次・二次)がその社員であるシート。本人のシートは含まない。 */
	findByEvaluator(employeeId: number): Promise<EvaluationSheetSummary[]>;
	/** 全社員の評価シート(下書きを含む)の一覧。Admin だけが読める。それ以外の人が呼ぶと失敗する。 */
	findOverview(): Promise<EvaluationSheetOverviewRow[]>;
}
