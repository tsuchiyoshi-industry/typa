import { messageOf } from "../../application/errorMessage";
import type { CsvFileGateway } from "../../application/ports/CsvFileGateway";
import type { ImportSheetDataInteractor } from "../../application/usecases/ImportSheetDataInteractor";
import { buildTemplate } from "../../application/usecases/sheetImportCsv";
import type {
	SheetImportFile,
	SheetImportRepository,
	SheetImportResult,
	SheetImportTemplate,
} from "../../domain/repositories/SheetImportRepository";

/** 導入処理の「データ取込」画面の操作。 */
export class SheetImportController {
	constructor(
		private readonly repository: Pick<SheetImportRepository, "findTemplate">,
		private readonly importUseCase: ImportSheetDataInteractor,
		private readonly csvGateway: CsvFileGateway,
	) {}

	/** Admin 以外や、実施中の評価期間がないときは、その理由を投げる。 */
	loadTemplate(): Promise<SheetImportTemplate> {
		return this.repository.findTemplate();
	}

	/** 保存したパス。保存ダイアログを取り消したら null。 */
	async saveTemplate(file: SheetImportFile, template: SheetImportTemplate): Promise<string | null> {
		const name = `${template.periodName}_${file === "goals" ? "目標" : "共通評価"}.csv`;
		const path = await this.csvGateway.selectDestination(name.replace(/[\\/:*?"<>|]/g, "_"));
		if (path) {
			await this.csvGateway.save(buildTemplate(file, template), path);
		}
		return path;
	}

	async run(goals: File | null, common: File | null, apply: boolean): Promise<SheetImportResult> {
		let result: SheetImportResult | null = null;
		try {
			await this.importUseCase.execute(
				{
					goals: goals && (await goals.arrayBuffer()),
					common: common && (await common.arrayBuffer()),
					apply,
				},
				{ present: (response) => (result = response) },
			);
		} catch (error) {
			console.error("Error importing sheet data:", error);
			return {
				errors: [{ file: null, line: null, message: messageOf(error, "取り込めませんでした。") }],
				summary: null,
				applied: false,
			};
		}
		return result ?? { errors: [], summary: null, applied: false };
	}
}
