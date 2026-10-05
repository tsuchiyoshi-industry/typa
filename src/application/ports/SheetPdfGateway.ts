import type { SheetExportDataDto } from "../dtos/ExportSheetDto";

export interface SheetPdfGateway {
	selectDestination(defaultName: string): Promise<string | null>;
	generate(data: SheetExportDataDto, outputPath: string): Promise<string>;
}
