/** CSV ファイルを、利用者が保存ダイアログで選んだ場所に書く。 */
export interface CsvFileGateway {
	/** 取り消されたら null。 */
	selectDestination(defaultName: string): Promise<string | null>;
	save(contents: string, outputPath: string): Promise<void>;
}
