import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type {
	EvaluationSheetRepository,
	EvaluationSheetSummary,
} from "../../domain/repositories/EvaluationSheetRepository";
import type { CategorizedSheetsDto, SheetSummaryDto } from "../dtos/SheetListDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

/** リクエストパラメータなし（空オブジェクトのみ許容） */
export type FetchCategorizedSheetsRequest = Record<string, never>;

export interface FetchCategorizedSheetsResponse {
	mySheets: CategorizedSheetsDto["mySheets"];
	subordinateSheets: CategorizedSheetsDto["subordinateSheets"];
}

export interface FetchCategorizedSheetsOutputPort
	extends OutputPort<FetchCategorizedSheetsResponse> {}

function toSheetSummaryDto(summary: EvaluationSheetSummary): SheetSummaryDto {
	return {
		id: summary.id,
		periodId: summary.periodId,
		employeeId: summary.employeeId,
		status: summary.status,
		totalScore: summary.totalScore,
		createdAt: summary.createdAt,
		updatedAt: summary.updatedAt,
		periodName: summary.periodName,
		startDate: summary.periodStart,
		endDate: summary.periodEnd,
		employeeName: summary.employeeName,
		employeeNo: summary.employeeNo,
	};
}

export class FetchCategorizedSheetsInteractor
	implements UseCase<FetchCategorizedSheetsRequest, FetchCategorizedSheetsOutputPort>
{
	constructor(
		private readonly employeeRepository: EmployeeRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(
		_request: FetchCategorizedSheetsRequest,
		outputPort: FetchCategorizedSheetsOutputPort,
	): Promise<void> {
		const currentEmployeeId = await this.employeeRepository.findCurrentEmployeeId();
		if (currentEmployeeId == null) {
			outputPort.present({ mySheets: [], subordinateSheets: [] });
			return;
		}

		const mySheets = await this.evaluationSheetRepository.findByOwner(currentEmployeeId);
		const subordinateIds = await this.employeeRepository.findSubordinateIds(currentEmployeeId);
		const subordinateSheets =
			subordinateIds.length > 0
				? await this.evaluationSheetRepository.findByEmployeeIds(subordinateIds)
				: [];

		outputPort.present({
			mySheets: mySheets.map(toSheetSummaryDto),
			subordinateSheets: subordinateSheets.map(toSheetSummaryDto),
		});
	}
}
