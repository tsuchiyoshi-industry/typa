import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toSheetExportDataDto } from "../../application/dtos/ExportSheetMapper";
import { exportData } from "../../test/exportFixture";
import { TauriSheetPdfGateway } from "./TauriSheetPdfGateway";

beforeEach(() => vi.stubGlobal("window", {}));
afterEach(() => {
	clearMocks();
	vi.unstubAllGlobals();
});
it("uses real Tauri invoke with mocked IPC and save dialog", async () => {
	const ipc = vi.fn<Parameters<typeof mockIPC>[0]>((command, args) => {
		if (command === "plugin:dialog|save") {
			return "C:\\test\\sheet.pdf";
		}
		if (command === "generate_pdf_with_typst") {
			return (args as Record<string, unknown>)?.outputPath;
		}
		throw new Error(`Unexpected IPC: ${command}`);
	});
	mockIPC(ipc);
	const gateway = new TauriSheetPdfGateway();
	const path = await gateway.selectDestination("test.pdf");
	expect(path).toBe("C:\\test\\sheet.pdf");
	const data = toSheetExportDataDto(exportData(), false);
	await expect(gateway.generate(data, path as string)).resolves.toBe(path);
	expect(ipc).toHaveBeenCalledWith("generate_pdf_with_typst", { data, outputPath: path });
	expect(ipc.mock.calls[0][1]).toMatchObject({
		options: { defaultPath: "test.pdf", filters: [{ name: "PDFファイル", extensions: ["pdf"] }] },
	});
});
it("preserves IPC rejection", async () => {
	mockIPC(() => {
		throw new Error("Rust rejected path");
	});
	await expect(
		new TauriSheetPdfGateway().generate(toSheetExportDataDto(exportData(), false), "test.pdf"),
	).rejects.toThrow("Rust rejected path");
});
