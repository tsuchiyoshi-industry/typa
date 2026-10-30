import type { CsvFileGateway } from "../../application/ports/CsvFileGateway";
import { type DownloadFile, downloadFile } from "../browserDownload";

/** ブラウザ版。CSV をダウンロードする。保存先は選ばせない(取り消しもない)。 */
export class WebCsvFileGateway implements CsvFileGateway {
	constructor(private readonly download: DownloadFile = downloadFile) {}

	selectDestination(defaultName: string): Promise<string | null> {
		return Promise.resolve(defaultName);
	}
	async save(contents: string, outputPath: string): Promise<void> {
		this.download(contents, "text/csv;charset=utf-8", outputPath);
	}
}
