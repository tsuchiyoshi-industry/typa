import { messageOf } from "../../application/errorMessage";
import type {
	ExportEvaluationSheetInteractor,
	ExportEvaluationSheetOutputPort,
} from "../../application/usecases/ExportEvaluationSheetInteractor";
import type { ExportSheetOverviewInteractor } from "../../application/usecases/ExportSheetOverviewInteractor";
import type {
	FetchCategorizedSheetsInteractor,
	FetchCategorizedSheetsOutputPort,
} from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type { FetchDistinctPeriodsInteractor } from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type {
	FetchSheetIndexInteractor,
	FetchSheetIndexOutputPort,
} from "../../application/usecases/FetchSheetIndexInteractor";
import type {
	FetchSheetOverviewInteractor,
	FetchSheetOverviewOutputPort,
} from "../../application/usecases/FetchSheetOverviewInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { SheetListPeriodsOutputPort } from "../presenters/SheetListPresenter";
import { requireCurrentEmployeeId } from "./currentEmployee";

export class SheetListController {
	constructor(
		private readonly fetchUseCase: FetchCategorizedSheetsInteractor,
		private readonly fetchOutputPort: FetchCategorizedSheetsOutputPort,
		private readonly exportUseCase: ExportEvaluationSheetInteractor,
		private readonly exportOutputPort: ExportEvaluationSheetOutputPort,
		private readonly presentError: (message: string) => void,
		private readonly employeeRepository: EmployeeRepository,
		private readonly fetchOverviewUseCase: FetchSheetOverviewInteractor,
		private readonly overviewOutputPort: FetchSheetOverviewOutputPort,
		private readonly exportOverviewUseCase: ExportSheetOverviewInteractor,
		private readonly fetchPeriodsUseCase: FetchDistinctPeriodsInteractor,
		private readonly periodsOutputPort: SheetListPeriodsOutputPort,
		private readonly fetchIndexUseCase: FetchSheetIndexInteractor,
		private readonly indexOutputPort: FetchSheetIndexOutputPort,
	) {}

	/** 最後に開いた評価期間の全社の一覧。読み直すとき、同じ期間も読み直す。 */
	private overviewPeriodId: number | null = null;

	async load(): Promise<void> {
		// 互いを待たずに読む。全社の一覧(Admin)が読めなくても、自分と部下の一覧は出したままにする
		await Promise.all([
			this.attempt(
				() => this.fetchUseCase.execute({}, this.fetchOutputPort),
				"シート一覧の取得に失敗しました",
			),
			// 全社の一覧は索引だけを読み、中身は評価期間を選んでから(loadOverview)読む
			this.attempt(
				() => this.fetchIndexUseCase.execute({}, this.indexOutputPort),
				"全社の評価シートの取得に失敗しました",
			),
			this.overviewPeriodId === null ? undefined : this.loadOverview(this.overviewPeriodId),
			// 新規作成を押せるかを決めるためだけに読む。読めなくても一覧の邪魔はしない
			this.fetchPeriodsUseCase
				.execute({}, this.periodsOutputPort)
				.catch(() => this.periodsOutputPort.presentUnavailable()),
		]);
	}

	async exportSheet(sheetId: number, employeeId: number, periodId: number): Promise<void> {
		const currentEmployeeId = await requireCurrentEmployeeId(
			this.employeeRepository,
			this.presentError,
		);
		if (currentEmployeeId === null) {
			return;
		}

		await this.attempt(
			() =>
				this.exportUseCase.execute(
					{ sheetId, employeeId, periodId, currentEmployeeId },
					this.exportOutputPort,
				),
			"シートの出力に失敗しました",
		);
	}

	/** その評価期間の全社の評価シートを読む(Admin だけ。ほかの人には索引が無く、画面は呼ばない)。 */
	async loadOverview(periodId: number): Promise<void> {
		this.overviewPeriodId = periodId;
		await this.attempt(
			() => this.fetchOverviewUseCase.execute({ periodId }, this.overviewOutputPort),
			"全社の評価シートの取得に失敗しました",
		);
	}

	/** 全社の評価シート一覧(その評価期間のぶん)を PDF にする。 */
	async exportOverview(periodId: number): Promise<void> {
		await this.attempt(
			() => this.exportOverviewUseCase.execute({ periodId }, this.exportOutputPort),
			"一覧の出力に失敗しました",
		);
	}

	private async attempt(run: () => Promise<void>, fallbackMessage: string): Promise<void> {
		try {
			await run();
		} catch (error) {
			this.presentError(messageOf(error, fallbackMessage));
		}
	}
}
