import type { EvaluationPeriodRepository } from "../../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CreateEvaluationSheetRequest {
	periodId: number;
	employeeId: number;
}

export interface CreateEvaluationSheetResponse {
	sheetId: number;
}

export interface CreateEvaluationSheetOutputPort
	extends OutputPort<CreateEvaluationSheetResponse> {}

export class CreateEvaluationSheetInteractor
	implements UseCase<CreateEvaluationSheetRequest, CreateEvaluationSheetOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly evaluationPeriodRepository: EvaluationPeriodRepository,
	) {}

	async execute(
		request: CreateEvaluationSheetRequest,
		outputPort: CreateEvaluationSheetOutputPort,
	): Promise<void> {
		// 作れるのは実施中の評価期間だけ。締めた期間にも、未開始・準備中の期間にも作れない(DB側でも拒否する)
		const period = await this.evaluationPeriodRepository.findById(request.periodId);
		if (!period?.isActive) {
			throw new Error("評価シートを作成できるのは、実施中の評価期間だけです。");
		}

		// 作るのはシートの行だけ。共通評価の結果は、評価者が保存したときにできる
		const sheetId = await this.evaluationSheetRepository.createOrGetSheet(
			request.periodId,
			request.employeeId,
		);

		outputPort.present({ sheetId });
	}
}
