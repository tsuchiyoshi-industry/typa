import { err, ok, type Result } from "../../domain/Result";
import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { SheetAccessError } from "../../domain/services/SheetAccessError";
import { Score } from "../../domain/valueObjects/Score";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

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

export type UpsertCommonEvaluationError =
	| SheetAccessError
	| { kind: "sheetNotFound" }
	| { kind: "commonItemInvalid" }
	| { kind: "scoreOutOfRange" };

export class UpsertCommonEvaluationInteractor
	implements
		FallibleUseCase<
			UpsertCommonEvaluationRequest,
			UpsertCommonEvaluationOutputPort,
			UpsertCommonEvaluationError
		>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly commonEvaluationRepository: Pick<CommonEvaluationRepository, "upsertResults">,
	) {}

	async execute(
		request: UpsertCommonEvaluationRequest,
		outputPort: UpsertCommonEvaluationOutputPort,
	): Promise<Result<void, UpsertCommonEvaluationError>> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			return err({ kind: "sheetNotFound" });
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const open = policy.periodOpen();
		if (!open.ok) {
			return open;
		}
		const canEditFirst = policy.canEditCommonEvaluationFirst();
		const canEditSecond = policy.canEditCommonEvaluationSecond();

		if (!canEditFirst && !canEditSecond) {
			return err({ kind: "forbidden", action: "editCommonEvaluation" });
		}
		const seen = new Set<number>();
		for (const result of request.results) {
			const existing = sheet.commonEvaluationResults.find(
				(entry) => entry.itemId === result.itemId,
			);
			if (!existing || seen.has(result.itemId)) {
				return err({ kind: "commonItemInvalid" });
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
				if (!Score.isValid(score)) {
					return err({ kind: "scoreOutOfRange" });
				}
			}
		}

		await this.commonEvaluationRepository.upsertResults(
			request.sheetId,
			request.results,
			canEditFirst,
			canEditSecond,
		);
		outputPort.present({ sheetId: request.sheetId, success: true });
		return ok(undefined);
	}
}
