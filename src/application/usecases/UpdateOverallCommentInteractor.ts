import { err, ok, type Result } from "../../domain/Result";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import {
	describeSheetAccessError,
	type SheetAccessError,
} from "../../domain/services/SheetAccessError";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export type OverallCommentTarget = "first" | "second";

export interface UpdateOverallCommentRequest {
	sheetId: number;
	target: OverallCommentTarget;
	comment: string;
	currentEmployeeId: number;
}

export interface UpdateOverallCommentResponse {
	sheet: EvaluationSheetDto;
}

export interface UpdateOverallCommentOutputPort extends OutputPort<UpdateOverallCommentResponse> {}

export type UpdateOverallCommentError = SheetAccessError | { kind: "sheetNotFound" };

export function describeUpdateOverallCommentError(error: UpdateOverallCommentError): string {
	return error.kind === "sheetNotFound"
		? "評価シートが見つかりません。"
		: describeSheetAccessError(error);
}

export class UpdateOverallCommentInteractor
	implements
		FallibleUseCase<
			UpdateOverallCommentRequest,
			UpdateOverallCommentOutputPort,
			UpdateOverallCommentError
		>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: UpdateOverallCommentRequest,
		outputPort: UpdateOverallCommentOutputPort,
	): Promise<Result<void, UpdateOverallCommentError>> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			return err({ kind: "sheetNotFound" });
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const open = policy.periodOpen();
		if (!open.ok) {
			return open;
		}
		if (!policy.canEditOverallComment(request.target)) {
			return err({
				kind: "forbidden",
				action: request.target === "first" ? "editFirstOverallComment" : "editSecondOverallComment",
			});
		}

		const updated = await this.evaluationSheetRepository.updateOverallComment(
			request.sheetId,
			request.target,
			request.comment,
		);
		const gradeName = await this.employeeRepository.findGradeName(updated.gradeId);

		outputPort.present({ sheet: toEvaluationSheetDto(updated, gradeName, policy) });
		return ok(undefined);
	}
}
