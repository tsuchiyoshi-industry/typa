import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
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
	constructor(private readonly evaluationSheetRepository: EvaluationSheetRepository) {}

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

		// シートの共通評価は、シート作成時の等級の項目(社員の今の等級でも、画面から渡された値でもない)
		const results = sheet.commonEvaluationResults;
		// 合計は「配点 × 評価」の合計。満点は totalWeight × 4
		const totals = EvaluationScoreTotals.fromCommonEvaluationResults(results);
		const response: LoadCommonEvaluationResponse = {
			results: results.map((result) => ({
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
					itemSetId: result.item.itemSetId,
				},
			})),
			totalFirstScore: totals.firstTotalScore,
			totalSecondScore: canViewSecond ? totals.secondTotalScore : null,
			totalWeight: results.reduce((sum, result) => sum + result.item.weight, 0),
			firstRate: totals.firstTotalRate,
			secondRate: canViewSecond ? totals.secondTotalRate : null,
		};
		outputPort.present(response);
	}
}
