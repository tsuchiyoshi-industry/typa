import type { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type {
	EvaluationSheetOverviewRow,
	EvaluationSheetRepository,
} from "../../domain/repositories/EvaluationSheetRepository";
import { canViewAllSheets } from "../../domain/services/EmployeeMasterAccessService";
import type { SheetOverviewDto } from "../dtos/SheetListDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";
import { toSheetSummaryDto } from "./FetchCategorizedSheetsInteractor";

export interface FetchSheetOverviewRequest {
	/** この評価期間のシートだけを読む(全期間を丸ごと読まない)。 */
	periodId: number;
}

export interface FetchSheetOverviewResponse {
	periodId: number;
	/** その評価期間の全社の評価シート。見られない人(Admin 以外)には null で、画面はこの一覧を出さない。 */
	sheets: SheetOverviewDto[] | null;
}

export interface FetchSheetOverviewOutputPort extends OutputPort<FetchSheetOverviewResponse> {}

/**
 * 全社の評価シートを見てよい人(Admin)なら、その人を返す。見られない人には null で、
 * 呼んだ側は DB に問い合わせない。画面の一覧・索引と帳票が同じ判定を使う。
 */
export async function overviewViewer(
	employeeMasterRepository: EmployeeMasterRepository,
): Promise<EmployeeProfile | null> {
	const viewer = await employeeMasterRepository.findCurrentEmployeeProfile();
	return viewer && canViewAllSheets(viewer.role) ? viewer : null;
}

/** その評価期間の全社の評価シートを、見てよい人(Admin)にだけ読む。画面の一覧と帳票が同じ行を使う。 */
export async function loadSheetOverview(
	employeeMasterRepository: EmployeeMasterRepository,
	evaluationSheetRepository: EvaluationSheetRepository,
	periodId: number,
): Promise<{ viewer: EmployeeProfile; rows: EvaluationSheetOverviewRow[] } | null> {
	const viewer = await overviewViewer(employeeMasterRepository);
	return viewer ? { viewer, rows: await evaluationSheetRepository.findOverview(periodId) } : null;
}

export class FetchSheetOverviewInteractor
	implements UseCase<FetchSheetOverviewRequest, FetchSheetOverviewOutputPort>
{
	constructor(
		private readonly employeeMasterRepository: EmployeeMasterRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(
		request: FetchSheetOverviewRequest,
		outputPort: FetchSheetOverviewOutputPort,
	): Promise<void> {
		const overview = await loadSheetOverview(
			this.employeeMasterRepository,
			this.evaluationSheetRepository,
			request.periodId,
		);
		outputPort.present({
			periodId: request.periodId,
			sheets:
				overview?.rows.map((row) => ({
					...toSheetSummaryDto(row),
					primaryEvaluator: row.primaryEvaluatorName,
					secondaryEvaluator: row.secondaryEvaluatorName,
					finalScore: row.finalScore,
					finalRank: row.finalRank,
				})) ?? null,
		});
	}
}
