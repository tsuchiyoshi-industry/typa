import { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import type { FinalEvaluationRank } from "../valueObjects/FinalEvaluationRank";
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
		public readonly finalEvaluationRank?: FinalEvaluationRank,
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
		finalEvaluationRank?: FinalEvaluationRank;
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
				EvaluationAllocatedScores.fromTotals(objectiveScoreTotals, commonEvaluationScoreTotals),
			params.status ?? EvaluationStatus.DRAFT,
			params.finalEvaluationRank,
		);
	}

	isEditable(): boolean {
		return this.status.isDraft();
	}

	equals(other: EvaluationSheet): boolean {
		return this.sheetId === other.sheetId;
	}
}
