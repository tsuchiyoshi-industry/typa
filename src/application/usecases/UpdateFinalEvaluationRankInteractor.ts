import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { FinalEvaluationRank } from "../../domain/valueObjects/FinalEvaluationRank";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateFinalEvaluationRankRequest {
	sheetId: number;
	letter?: string;
	level?: string;
	currentEmployeeId: number;
}

export interface UpdateFinalEvaluationRankResponse {
	sheet: EvaluationSheetDto;
}

export interface UpdateFinalEvaluationRankOutputPort
	extends OutputPort<UpdateFinalEvaluationRankResponse> {}

export class UpdateFinalEvaluationRankInteractor
	implements UseCase<UpdateFinalEvaluationRankRequest, UpdateFinalEvaluationRankOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: UpdateFinalEvaluationRankRequest,
		outputPort: UpdateFinalEvaluationRankOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		if (!policy.canDecideFinalEvaluationRank()) {
			throw new Error("二次評価者のみ最終評価ランクを決定できます。");
		}

		const finalEvaluationRank =
			request.letter && request.level
				? FinalEvaluationRank.fromOptional(request.letter, request.level)
				: undefined;
		const updated = await this.evaluationSheetRepository.updateFinalEvaluationRank(
			request.sheetId,
			finalEvaluationRank,
		);
		const gradeName = await this.employeeRepository.findGradeName(updated.subject.gradeId);

		outputPort.present({ sheet: toEvaluationSheetDto(updated, gradeName, policy) });
	}
}
