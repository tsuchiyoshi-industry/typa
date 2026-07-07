import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpsertCommonEvaluationRequest {
	sheetId: number;
	currentEmployeeId: number;
	results: Array<{
		id: number;
		itemId: number;
		firstComment: string;
		firstScore: number;
		secondScore: number;
	}>;
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
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly evaluationScoreUpdateService: EvaluationScoreUpdateService,
	) {}

	async execute(
		request: UpsertCommonEvaluationRequest,
		outputPort: UpsertCommonEvaluationOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const canEditFirst = policy.canEditCommonEvaluationFirst();
		const canEditSecond = policy.canEditCommonEvaluationSecond();

		if (!canEditFirst && !canEditSecond) {
			throw new Error("共通評価を更新する権限がありません。");
		}

		await this.evaluationScoreUpdateService.upsertCommonEvaluationResults(
			request.sheetId,
			request.results,
			canEditFirst,
			canEditSecond,
		);
		outputPort.present({ sheetId: request.sheetId, success: true });
	}
}
