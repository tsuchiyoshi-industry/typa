import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type {
	SheetExportDataDto,
	SheetOverviewExportDto,
} from "../../application/dtos/ExportSheetDto";
import type { SheetPdfGateway } from "../../application/ports/SheetPdfGateway";

export class TauriSheetPdfGateway implements SheetPdfGateway {
	selectDestination(defaultName: string): Promise<string | null> {
		return save({
			title: "評価シートを保存",
			defaultPath: defaultName,
			filters: [{ name: "PDFファイル", extensions: ["pdf"] }],
		});
	}
	generate(data: SheetExportDataDto, outputPath: string): Promise<string> {
		return invoke<string>("generate_pdf_with_typst", { data, outputPath });
	}
	generateOverview(data: SheetOverviewExportDto, outputPath: string): Promise<string> {
		return invoke<string>("generate_sheet_overview_pdf", { data, outputPath });
	}
}
