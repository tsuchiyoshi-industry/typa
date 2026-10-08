import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
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
				primaryIsFinalEvaluator: false,
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
					objectiveAllocationScore: EvaluationAllocation.DEFAULT.objective,
					objectiveSecondRate: 0,
					objectiveEvaluationScore: 0,
					commonEvaluationAllocationScore: EvaluationAllocation.DEFAULT.common,
					commonEvaluationSecondRate: 0,
					commonEvaluationEvaluationScore: 0,
					totalEvaluationScore: 0,
				},
				status: EvaluationStatus.DRAFT.toString(),
				isEditable: true,
			});
			return;
		}

		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		if (!policy.canViewSheet()) {
			throw new Error("評価シートを閲覧する権限がありません。");
		}
		const gradeName = await this.employeeRepository.findGradeName(sheet.gradeId);
		outputPort.present(toEvaluationSheetDto(sheet, gradeName, policy));
	}
}
