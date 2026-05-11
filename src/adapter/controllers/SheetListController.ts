import type {
	FetchCategorizedSheetsInteractor,
	FetchCategorizedSheetsOutputPort,
} from "../../application/usecases/FetchCategorizedSheetsInteractor";

export class SheetListController {
	constructor(
		private readonly useCase: FetchCategorizedSheetsInteractor,
		private readonly outputPort: FetchCategorizedSheetsOutputPort,
		private readonly presentError: (message: string) => void,
	) {}

	async load(): Promise<void> {
		try {
			await this.useCase.execute({}, this.outputPort);
		} catch (error) {
			this.presentError(error instanceof Error ? error.message : "シート一覧の取得に失敗しました");
		}
	}
}
