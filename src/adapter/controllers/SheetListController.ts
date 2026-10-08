import type {
	ExportEvaluationSheetInteractor,
	ExportEvaluationSheetOutputPort,
} from "../../application/usecases/ExportEvaluationSheetInteractor";
import type { ExportSheetOverviewInteractor } from "../../application/usecases/ExportSheetOverviewInteractor";
import type {
	FetchCategorizedSheetsInteractor,
	FetchCategorizedSheetsOutputPort,
} from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type {
	FetchSheetOverviewInteractor,
	FetchSheetOverviewOutputPort,
} from "../../application/usecases/FetchSheetOverviewInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
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
	) {}

	async load(): Promise<void> {
		await this.attempt(
			() => this.fetchUseCase.execute({}, this.fetchOutputPort),
			"シート一覧の取得に失敗しました",
		);
		// 全社の一覧(Admin)が読めなくても、自分と部下の一覧は出したままにする
		await this.attempt(
			() => this.fetchOverviewUseCase.execute({}, this.overviewOutputPort),
			"全社の評価シートの取得に失敗しました",
		);
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
			this.presentError(error instanceof Error ? error.message : fallbackMessage);
		}
	}
}
