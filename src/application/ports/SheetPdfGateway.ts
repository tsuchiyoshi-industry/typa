import type { SheetExportDataDto, SheetOverviewExportDto } from "../dtos/ExportSheetDto";

export interface SheetPdfGateway {
	selectDestination(defaultName: string): Promise<string | null>;
	generate(data: SheetExportDataDto, outputPath: string): Promise<string>;
	generateOverview(data: SheetOverviewExportDto, outputPath: string): Promise<string>;
}
