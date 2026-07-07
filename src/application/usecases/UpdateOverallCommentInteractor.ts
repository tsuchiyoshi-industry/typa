import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

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

export class UpdateOverallCommentInteractor
	implements UseCase<UpdateOverallCommentRequest, UpdateOverallCommentOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: UpdateOverallCommentRequest,
		outputPort: UpdateOverallCommentOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		if (!policy.canEditOverallComment(request.target)) {
			throw new Error(
				request.target === "first"
					? "一次評価者の総評を更新する権限がありません。"
					: "二次評価者の総評を更新する権限がありません。",
			);
		}

		const updated = await this.evaluationSheetRepository.updateOverallComment(
			request.sheetId,
			request.target,
			request.comment,
		);
		const gradeName = await this.employeeRepository.findGradeName(updated.subject.gradeId);

		outputPort.present({ sheet: toEvaluationSheetDto(updated, gradeName, policy) });
	}
}
