import type { EvaluationPeriod } from "../entities/EvaluationPeriod";

export interface EvaluationPeriodRepository {
	findDistinctPeriods(): Promise<EvaluationPeriod[]>;
	findById(periodId: number): Promise<EvaluationPeriod | null>;
}
