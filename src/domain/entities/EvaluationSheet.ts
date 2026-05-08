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
		public readonly objectives: Milestone[],
		public readonly commonEvaluationResults: CommonEvaluationResult[],
	) {}

	static create(params: {
		sheetId: number;
		subject: Employee;
		evaluationPeriod: EvaluationPeriod;
		primaryEvaluatorName: string;
		secondaryEvaluatorName: string;
		objectives: Milestone[];
		commonEvaluationResults?: CommonEvaluationResult[];
	}): EvaluationSheet {
		return new EvaluationSheet(
			params.sheetId,
			params.subject,
			params.evaluationPeriod,
			params.primaryEvaluatorName,
			params.secondaryEvaluatorName,
			params.objectives,
			params.commonEvaluationResults ?? [],
		);
	}

	equals(other: EvaluationSheet): boolean {
		return this.sheetId === other.sheetId;
	}
}
