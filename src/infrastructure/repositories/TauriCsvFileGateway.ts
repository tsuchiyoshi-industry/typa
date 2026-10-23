import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { CsvFileGateway } from "../../application/ports/CsvFileGateway";

export class TauriCsvFileGateway implements CsvFileGateway {
	selectDestination(defaultName: string): Promise<string | null> {
		return save({
			title: "テンプレートを保存",
			defaultPath: defaultName,
			filters: [{ name: "CSVファイル", extensions: ["csv"] }],
		});
	}
	async save(contents: string, outputPath: string): Promise<void> {
		await invoke("save_csv", { contents, outputPath });
	}
}
