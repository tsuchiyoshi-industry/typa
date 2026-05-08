import type {
	ExportEvaluationSheetInteractor,
	ExportEvaluationSheetOutputPort,
} from "../../application/usecases/ExportEvaluationSheetInteractor";
import type {
	FetchCategorizedSheetsInteractor,
	FetchCategorizedSheetsOutputPort,
} from "../../application/usecases/FetchCategorizedSheetsInteractor";

export class SheetListController {
	constructor(
		private readonly fetchUseCase: FetchCategorizedSheetsInteractor,
		private readonly fetchOutputPort: FetchCategorizedSheetsOutputPort,
		private readonly exportUseCase: ExportEvaluationSheetInteractor,
		private readonly exportOutputPort: ExportEvaluationSheetOutputPort,
		private readonly presentError: (message: string) => void,
	) {}

	async load(): Promise<void> {
		try {
			await this.fetchUseCase.execute({}, this.fetchOutputPort);
		} catch (error) {
			this.presentError(error instanceof Error ? error.message : "シート一覧の取得に失敗しました");
		}
	}

	async exportSheet(sheetId: number, employeeId: number, periodId: number): Promise<void> {
		try {
			await this.exportUseCase.execute({ sheetId, employeeId, periodId }, this.exportOutputPort);
		} catch (error) {
			this.presentError(error instanceof Error ? error.message : "シートの出力に失敗しました");
		}
	}
}
