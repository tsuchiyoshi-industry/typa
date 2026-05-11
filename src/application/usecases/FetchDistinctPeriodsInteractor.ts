import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationPeriodDto } from "../dtos/EvaluationPeriodDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

/** リクエストパラメータなし（空オブジェクトのみ許容） */
export type FetchDistinctPeriodsRequest = Record<string, never>;

export interface FetchDistinctPeriodsResponse {
	periods: EvaluationPeriodDto[];
}

export interface FetchDistinctPeriodsOutputPort extends OutputPort<FetchDistinctPeriodsResponse> {}

export class FetchDistinctPeriodsInteractor
	implements UseCase<FetchDistinctPeriodsRequest, FetchDistinctPeriodsOutputPort>
{
	constructor(private readonly evaluationPeriodRepository: EvaluationPeriodRepository) {}

	async execute(
		_request: FetchDistinctPeriodsRequest,
		outputPort: FetchDistinctPeriodsOutputPort,
	): Promise<void> {
		const periods = await this.evaluationPeriodRepository.findDistinctPeriods();
		const payload = periods.map((period) => ({
			id: period.id,
			periodName: period.periodName,
			startDate: period.startDate,
			endDate: period.endDate,
			isActive: period.isActive,
		}));
		outputPort.present({ periods: payload });
	}
}
