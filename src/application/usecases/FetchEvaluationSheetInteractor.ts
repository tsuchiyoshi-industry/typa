import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import {
	COMMON_EVALUATION_ALLOCATION_SCORE,
	OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
} from "../../domain/valueObjects/EvaluationAllocatedScores";
import type { EvaluationSheetDto } from "../dtos/EvaluationSheetDto";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface FetchEvaluationSheetRequest {
	sheetId: number;
	currentEmployeeId: number | null;
}

export interface FetchEvaluationSheetResponse extends EvaluationSheetDto {}

export interface FetchEvaluationSheetOutputPort extends OutputPort<FetchEvaluationSheetResponse> {}

export class FetchEvaluationSheetInteractor
	implements UseCase<FetchEvaluationSheetRequest, FetchEvaluationSheetOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: FetchEvaluationSheetRequest,
		outputPort: FetchEvaluationSheetOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			outputPort.present({
				sheetId: 0,
				subject: null,
				evaluationPeriod: null,
				primaryEvaluator: "未設定",
				secondaryEvaluator: "未設定",
				firstOverallComment: "",
				secondOverallComment: "",
				objectives: [],
				objectiveScoreTotals: {
					firstTotalScore: 0,
					firstTotalRate: 0,
					secondTotalScore: 0,
					secondTotalRate: 0,
				},
				commonEvaluationScoreTotals: {
					firstTotalScore: 0,
					firstTotalRate: 0,
					secondTotalScore: 0,
					secondTotalRate: 0,
				},
				allocatedScores: {
					objectiveAllocationScore: OBJECTIVE_EVALUATION_ALLOCATION_SCORE,
					objectiveSecondRate: 0,
					objectiveEvaluationScore: 0,
					commonEvaluationAllocationScore: COMMON_EVALUATION_ALLOCATION_SCORE,
					commonEvaluationSecondRate: 0,
					commonEvaluationEvaluationScore: 0,
					totalEvaluationScore: 0,
				},
				status: "draft",
				isEditable: true,
			});
			return;
		}

		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const gradeName = await this.employeeRepository.findGradeName(sheet.subject.gradeId);
		outputPort.present(toEvaluationSheetDto(sheet, gradeName, policy));
	}
}
