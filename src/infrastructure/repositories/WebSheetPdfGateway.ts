import type {
	SheetExportDataDto,
	SheetOverviewExportDto,
} from "../../application/dtos/ExportSheetDto";
import type { SheetPdfGateway } from "../../application/ports/SheetPdfGateway";
import { type DownloadFile, downloadFile } from "../browserDownload";
import { type RenderPdf, renderPdf } from "../pdf/WasmPdfRenderer";

/** ブラウザ版。PDF は WASM で作り、ダウンロードする。保存先は選ばせない(取り消しもない)。 */
export class WebSheetPdfGateway implements SheetPdfGateway {
	constructor(
		private readonly render: RenderPdf = renderPdf,
		private readonly download: DownloadFile = downloadFile,
	) {}

	selectDestination(defaultName: string): Promise<string | null> {
		return Promise.resolve(defaultName);
	}
	generate(data: SheetExportDataDto, outputPath: string): Promise<string> {
		return this.save("sheet", data, outputPath);
	}
	generateOverview(data: SheetOverviewExportDto, outputPath: string): Promise<string> {
		return this.save("overview", data, outputPath);
	}

	private async save(kind: "sheet" | "overview", data: unknown, fileName: string): Promise<string> {
		const pdf = await this.render(kind, data);
		this.download(pdf, "application/pdf", fileName);
		return fileName;
	}
}
