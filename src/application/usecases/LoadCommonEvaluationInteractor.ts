import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { CommonEvaluationSummaryDto } from "../dtos/CommonEvaluationDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface LoadCommonEvaluationRequest {
	sheetId: number;
	gradeId: number | null;
}

export interface LoadCommonEvaluationResponse extends CommonEvaluationSummaryDto {}

export interface LoadCommonEvaluationOutputPort extends OutputPort<LoadCommonEvaluationResponse> {}

export class LoadCommonEvaluationInteractor
	implements UseCase<LoadCommonEvaluationRequest, LoadCommonEvaluationOutputPort>
{
	constructor(private readonly commonEvaluationRepository: CommonEvaluationRepository) {}

	async execute(
		request: LoadCommonEvaluationRequest,
		outputPort: LoadCommonEvaluationOutputPort,
	): Promise<void> {
		const summary = await this.commonEvaluationRepository.findResultsBySheetId(
			request.sheetId,
			request.gradeId,
		);
		const response: LoadCommonEvaluationResponse = {
			results: summary.results.map((result) => ({
				id: result.id,
				sheetId: result.sheetId,
				itemId: result.itemId,
				firstScore: result.firstScore.toNumber(),
				secondScore: result.secondScore.toNumber(),
				firstComment: result.firstComment.toString(),
				item: {
					id: result.item.id,
					title: result.item.title,
					description: result.item.description,
					weight: result.item.weight,
					gradeId: result.item.gradeId,
				},
			})),
			totalFirstScore: summary.totalFirstScore,
			totalSecondScore: summary.totalSecondScore,
			totalWeight: summary.totalWeight,
			firstRate: summary.firstRate,
			secondRate: summary.secondRate,
		};
		outputPort.present(response);
	}
}
