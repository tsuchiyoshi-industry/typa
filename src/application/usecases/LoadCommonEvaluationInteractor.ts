import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { CommonEvaluationSummaryDto } from "../dtos/CommonEvaluationDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface LoadCommonEvaluationRequest {
	sheetId: number;
	gradeId: number | null;
	currentEmployeeId: number;
}

export interface LoadCommonEvaluationResponse extends CommonEvaluationSummaryDto {}

export interface LoadCommonEvaluationOutputPort extends OutputPort<LoadCommonEvaluationResponse> {}

export class LoadCommonEvaluationInteractor
	implements UseCase<LoadCommonEvaluationRequest, LoadCommonEvaluationOutputPort>
{
	constructor(
		private readonly commonEvaluationRepository: CommonEvaluationRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(
		request: LoadCommonEvaluationRequest,
		outputPort: LoadCommonEvaluationOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		if (!policy.canViewCommonEvaluation()) {
			throw new Error("共通評価を閲覧する権限がありません。");
		}
		const canViewSecond = policy.canViewCommonEvaluationSecond();

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
				secondScore: canViewSecond ? result.secondScore.toNumber() : null,
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
			totalSecondScore: canViewSecond ? summary.totalSecondScore : null,
			totalWeight: summary.totalWeight,
			firstRate: summary.firstRate,
			secondRate: canViewSecond ? summary.secondRate : null,
		};
		outputPort.present(response);
	}
}
