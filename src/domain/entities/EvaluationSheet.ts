import {
	EvaluationAllocatedScores,
	TOTAL_EVALUATION_ALLOCATION_SCORE,
} from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationRank } from "../valueObjects/EvaluationRank";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import type { CommonEvaluationResult } from "./CommonEvaluationResult";
import type { Employee } from "./Employee";
import type { EvaluationPeriod } from "./EvaluationPeriod";
import type { Milestone } from "./Milestone";

export class EvaluationSheet {
	constructor(
		public readonly sheetId: number,
		public readonly subject: Employee,
		public readonly evaluationPeriod: EvaluationPeriod,
		public readonly primaryEvaluatorName: string,
		public readonly secondaryEvaluatorName: string,
		public readonly firstOverallComment: string,
		public readonly secondOverallComment: string,
		public readonly objectives: Milestone[],
		public readonly commonEvaluationResults: CommonEvaluationResult[],
		public readonly objectiveScoreTotals: EvaluationScoreTotals,
		public readonly commonEvaluationScoreTotals: EvaluationScoreTotals,
		public readonly allocatedScores: EvaluationAllocatedScores,
		public readonly status: EvaluationStatus,
		/** 確定時に保存したランク。未確定の段階では undefined、または過去の手入力値が残っていることがある。 */
		public readonly finalEvaluationRank?: EvaluationRank,
		public readonly firstEvaluationRank?: EvaluationRank,
	) {}

	static create(params: {
		sheetId: number;
		subject: Employee;
		evaluationPeriod: EvaluationPeriod;
		primaryEvaluatorName: string;
		secondaryEvaluatorName: string;
		firstOverallComment?: string;
		secondOverallComment?: string;
		objectives: Milestone[];
		commonEvaluationResults?: CommonEvaluationResult[];
		objectiveScoreTotals?: EvaluationScoreTotals;
		commonEvaluationScoreTotals?: EvaluationScoreTotals;
		allocatedScores?: EvaluationAllocatedScores;
		status?: EvaluationStatus;
		finalEvaluationRank?: EvaluationRank;
		firstEvaluationRank?: EvaluationRank;
	}): EvaluationSheet {
		const commonEvaluationResults = params.commonEvaluationResults ?? [];
		const objectiveScoreTotals =
			params.objectiveScoreTotals ?? EvaluationScoreTotals.fromObjectives(params.objectives);
		const commonEvaluationScoreTotals =
			params.commonEvaluationScoreTotals ??
			EvaluationScoreTotals.fromCommonEvaluationResults(commonEvaluationResults);
		return new EvaluationSheet(
			params.sheetId,
			params.subject,
			params.evaluationPeriod,
			params.primaryEvaluatorName,
			params.secondaryEvaluatorName,
			params.firstOverallComment ?? "",
			params.secondOverallComment ?? "",
			params.objectives,
			commonEvaluationResults,
			objectiveScoreTotals,
			commonEvaluationScoreTotals,
			params.allocatedScores ??
				EvaluationAllocatedScores.fromTotals(
					objectiveScoreTotals,
					commonEvaluationScoreTotals,
					params.subject.primaryIsFinalEvaluator(),
				),
			params.status ?? EvaluationStatus.DRAFT,
			params.finalEvaluationRank,
			params.firstEvaluationRank,
		);
	}

	/** 二次評価者「なし」の社員は、一次評価者が最終評価者を兼ねる。 */
	primaryIsFinalEvaluator(): boolean {
		return this.subject.primaryIsFinalEvaluator();
	}

	/** 一次評価の評価点(目標20点 + 共通評価80点)。 */
	firstEvaluationScore(): number {
		return EvaluationAllocatedScores.fromTotals(
			this.objectiveScoreTotals,
			this.commonEvaluationScoreTotals,
			true,
		).totalEvaluationScore;
	}

	/** 一次評価ランク。一次評価の確定後は保存値、確定前は現在の点数から決まる見込み。 */
	resolveFirstEvaluationRank(): EvaluationRank {
		return (
			(this.status.isFirstEvaluationConfirmed() ? this.firstEvaluationRank : undefined) ??
			EvaluationRank.fromScore(this.firstEvaluationScore(), TOTAL_EVALUATION_ALLOCATION_SCORE)
		);
	}

	/** 最終評価ランク。最終評価者(二次評価者。「なし」の社員は一次評価者)の評価点から決まる。 */
	resolveFinalEvaluationRank(): EvaluationRank {
		return (
			(this.status.isFinalized() ? this.finalEvaluationRank : undefined) ??
			EvaluationRank.fromScore(
				this.allocatedScores.totalEvaluationScore,
				TOTAL_EVALUATION_ALLOCATION_SCORE,
			)
		);
	}

	isEditable(): boolean {
		return this.status.isDraft();
	}

	equals(other: EvaluationSheet): boolean {
		return this.sheetId === other.sheetId;
	}
}
