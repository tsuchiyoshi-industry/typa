import type {
	CommonEvaluationDraft,
	CommonEvaluationRepository,
} from "../../domain/repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { createSheetWithCommonEvaluation } from "../../domain/services/EvaluationSheetDomainService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CreateEvaluationSheetRequest {
	periodId: number;
	employeeId: number;
	drafts: Array<{
		itemId: number;
		firstComment: string;
		firstScore: number;
		secondScore: number;
	}>;
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
		private readonly commonEvaluationRepository: CommonEvaluationRepository,
	) {}

	async execute(
		request: CreateEvaluationSheetRequest,
		outputPort: CreateEvaluationSheetOutputPort,
	): Promise<void> {
		const drafts: CommonEvaluationDraft[] = request.drafts.map((draft) => ({
			itemId: draft.itemId,
			firstComment: draft.firstComment,
			firstScore: draft.firstScore,
			secondScore: draft.secondScore,
		}));

		const sheetId = await createSheetWithCommonEvaluation(
			request.periodId,
			request.employeeId,
			drafts,
			this.evaluationSheetRepository,
			this.commonEvaluationRepository,
		);

		outputPort.present({ sheetId });
	}
}
