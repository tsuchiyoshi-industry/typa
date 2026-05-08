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
		// 1. 現在のユーザー情報を取得
		const { data: currentEmployeeId, error } =
			await this.employeeRepository.findCurrentEmployeeId();

		// 2. ガード句：エラーがある、またはIDが取得できない場合は空で返す
		if (error || currentEmployeeId === null) {
			if (error) {
				console.error("シート一覧取得中にエラー:", error);
			}
			return outputPort.present({ mySheets: [], subordinateSheets: [] });
		}

		// 3. データの並行取得（Promise.all を使って高速化）
		const [mySheets, subordinateIds] = await Promise.all([
			this.evaluationSheetRepository.findByOwner(currentEmployeeId),
			this.employeeRepository.findSubordinateIds(currentEmployeeId),
		]);

		// 4. 部下がいる場合のみシートを取得
		const subordinateSheets =
			subordinateIds.length > 0
				? await this.evaluationSheetRepository.findByEmployeeIds(subordinateIds)
				: [];

		// 5. DTOへ変換して出力
		outputPort.present({
			mySheets: mySheets.map(toSheetSummaryDto),
			subordinateSheets: subordinateSheets.map(toSheetSummaryDto),
		});
	}
}
