import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { Score } from "../../domain/valueObjects/Score";
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
		policy.assertPeriodOpen();
		const canEditFirst = policy.canEditCommonEvaluationFirst();
		const canEditSecond = policy.canEditCommonEvaluationSecond();

		if (!canEditFirst && !canEditSecond) {
			throw new Error("共通評価を更新する権限がありません。");
		}
		const seen = new Set<number>();
		for (const result of request.results) {
			const existing = sheet.commonEvaluationResults.find(
				(entry) => entry.itemId === result.itemId,
			);
			if (!existing || seen.has(result.itemId)) {
				throw new Error("共通評価項目が不正または重複しています。");
			}
			seen.add(result.itemId);
			const scores: number[] = [];
			if (canEditFirst) {
				scores.push(result.firstScore);
			}
			if (canEditSecond) {
				scores.push(result.secondScore);
			}
			for (const score of scores) {
				// 評価は 0(未評価)〜4。配点は係数で、点数の上限ではない
				if (!Number.isInteger(score) || score < 0 || score > Score.MAX) {
					throw new Error("共通評価の評価点が範囲外です。");
				}
			}
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
