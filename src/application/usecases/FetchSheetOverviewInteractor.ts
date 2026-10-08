import type { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type {
	EvaluationSheetOverviewRow,
	EvaluationSheetRepository,
} from "../../domain/repositories/EvaluationSheetRepository";
import { canViewSheetOverview } from "../../domain/services/EmployeeMasterAccessService";
import type { SheetOverviewDto } from "../dtos/SheetListDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";
import { toSheetSummaryDto } from "./FetchCategorizedSheetsInteractor";

/** リクエストパラメータなし（空オブジェクトのみ許容） */
export type FetchSheetOverviewRequest = Record<string, never>;

export interface FetchSheetOverviewResponse {
	/** 全社の評価シート。見られない人(Admin 以外)には null で、画面はこの一覧を出さない。 */
	sheets: SheetOverviewDto[] | null;
}

export interface FetchSheetOverviewOutputPort extends OutputPort<FetchSheetOverviewResponse> {}

/**
 * 全社の評価シートを、見てよい人(Admin)にだけ読む。見られない人には null を返し、DB には問い合わせない。
 * 画面の一覧と帳票が同じ判定と同じ行を使う。
 */
export async function loadSheetOverview(
	employeeMasterRepository: EmployeeMasterRepository,
	evaluationSheetRepository: EvaluationSheetRepository,
): Promise<{ viewer: EmployeeProfile; rows: EvaluationSheetOverviewRow[] } | null> {
	const viewer = await employeeMasterRepository.findCurrentEmployeeProfile();
	if (!viewer || !canViewSheetOverview(viewer.role)) {
		return null;
	}
	return { viewer, rows: await evaluationSheetRepository.findOverview() };
}

export class FetchSheetOverviewInteractor
	implements UseCase<FetchSheetOverviewRequest, FetchSheetOverviewOutputPort>
{
	constructor(
		private readonly employeeMasterRepository: EmployeeMasterRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(
		_request: FetchSheetOverviewRequest,
		outputPort: FetchSheetOverviewOutputPort,
	): Promise<void> {
		const overview = await loadSheetOverview(
			this.employeeMasterRepository,
			this.evaluationSheetRepository,
		);
		outputPort.present({
			sheets:
				overview?.rows.map((row) => ({
					...toSheetSummaryDto(row),
					primaryEvaluator: row.primaryEvaluatorName,
					secondaryEvaluator: row.secondaryEvaluatorName,
				})) ?? null,
		});
	}
}
