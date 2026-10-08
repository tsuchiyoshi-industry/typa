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
		status: summary.status.toString(),
		totalScore: null,
		createdAt: summary.createdAt,
		updatedAt: summary.updatedAt,
		periodName: summary.periodName,
		startDate: summary.periodStart,
		endDate: summary.periodEnd,
		employeeName: summary.employeeName,
		employeeNo: summary.employeeNo,
		gradeName: summary.gradeName,
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

		// 3. 自分のシートと、自分が評価者になっているシート。評価者はシートが持つもので引くので、
		// 評価者を付け替えたあとも、確定済みのシートは評価した人の一覧に残る
		const [mySheets, subordinateSheets] = await Promise.all([
			this.evaluationSheetRepository.findByOwner(currentEmployeeId),
			this.evaluationSheetRepository.findByEvaluator(currentEmployeeId),
		]);

		// 4. DTOへ変換して出力
		outputPort.present({
			mySheets: mySheets.map(toSheetSummaryDto),
			// 下書き中のシートは評価者に見せない
			subordinateSheets: subordinateSheets
				.filter((summary) => !summary.status.isDraft())
				.map(toSheetSummaryDto),
		});
	}
}
