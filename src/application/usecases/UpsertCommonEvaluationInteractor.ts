import type { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpsertCommonEvaluationRequest {
	sheetId: number;
	results: Array<{
		id: number;
		itemId: number;
		firstComment: string;
		firstScore: number;
		secondScore: number;
	}>;
	canEditFirst: boolean;
	canEditSecond: boolean;
}

export interface UpsertCommonEvaluationResponse {
	sheetId: number;
	success: boolean;
}

export interface UpsertCommonEvaluationOutputPort
	extends OutputPort<UpsertCommonEvaluationResponse> {}

export class UpsertCommonEvaluationInteractor
	implements UseCase<UpsertCommonEvaluationRequest, UpsertCommonEvaluationOutputPort>
{
	constructor(private readonly evaluationScoreUpdateService: EvaluationScoreUpdateService) {}

	async execute(
		request: UpsertCommonEvaluationRequest,
		outputPort: UpsertCommonEvaluationOutputPort,
	): Promise<void> {
		await this.evaluationScoreUpdateService.upsertCommonEvaluationResults(
			request.sheetId,
			request.results,
			request.canEditFirst,
			request.canEditSecond,
		);
		outputPort.present({ sheetId: request.sheetId, success: true });
	}
}
