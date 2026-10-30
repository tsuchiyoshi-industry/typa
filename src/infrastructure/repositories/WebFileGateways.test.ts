// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	SheetExportDataDto,
	SheetOverviewExportDto,
} from "../../application/dtos/ExportSheetDto";
import { downloadFile } from "../browserDownload";
import { WebCsvFileGateway } from "./WebCsvFileGateway";
import { WebSheetPdfGateway } from "./WebSheetPdfGateway";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("WebSheetPdfGateway", () => {
	it("downloads the PDF under the suggested name instead of asking for a place", async () => {
		const pdf = new Uint8Array([1, 2, 3]);
		const render = vi.fn(async () => pdf);
		const download = vi.fn();
		const gateway = new WebSheetPdfGateway(render, download);

		// ブラウザは保存先を選ばせない(ダウンロードフォルダに入る)。取り消しにもならない
		await expect(gateway.selectDestination("評価シート_山田.pdf")).resolves.toBe(
			"評価シート_山田.pdf",
		);
		const data = { sheetId: 1 } as unknown as SheetExportDataDto;
		await expect(gateway.generate(data, "評価シート_山田.pdf")).resolves.toBe(
			"評価シート_山田.pdf",
		);
		expect(render).toHaveBeenCalledWith("sheet", data);
		expect(download).toHaveBeenCalledWith(pdf, "application/pdf", "評価シート_山田.pdf");

		const overview = { periodName: "26期" } as unknown as SheetOverviewExportDto;
		await gateway.generateOverview(overview, "一覧.pdf");
		expect(render).toHaveBeenLastCalledWith("overview", overview);
		expect(download).toHaveBeenLastCalledWith(pdf, "application/pdf", "一覧.pdf");
	});

	it("downloads nothing when the PDF could not be made", async () => {
		const download = vi.fn();
		const gateway = new WebSheetPdfGateway(async () => {
			throw new Error("Typst compilation failed");
		}, download);
		await expect(gateway.generate({} as SheetExportDataDto, "a.pdf")).rejects.toThrow(
			"Typst compilation failed",
		);
		expect(download).not.toHaveBeenCalled();
	});
});

describe("WebCsvFileGateway", () => {
	it("downloads the CSV under the suggested name", async () => {
		const download = vi.fn();
		const gateway = new WebCsvFileGateway(download);
		await expect(gateway.selectDestination("社員.csv")).resolves.toBe("社員.csv");
		await gateway.save("社員番号,氏名\n", "社員.csv");
		expect(download).toHaveBeenCalledWith("社員番号,氏名\n", "text/csv;charset=utf-8", "社員.csv");
	});
});

describe("downloadFile", () => {
	it("clicks a temporary download link and releases the file afterwards", async () => {
		const create = vi.fn(() => "blob:typa/1");
		const revoke = vi.fn();
		URL.createObjectURL = create;
		URL.revokeObjectURL = revoke;
		const clicked: HTMLAnchorElement[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			clicked.push(this);
		});

		downloadFile("a,b\n", "text/csv;charset=utf-8", "社員.csv");

		expect(clicked).toHaveLength(1);
		expect(clicked[0].download).toBe("社員.csv");
		expect(clicked[0].getAttribute("href")).toBe("blob:typa/1");
		expect(clicked[0].isConnected).toBe(false);
		const blob = (create.mock.calls[0] as unknown as [Blob])[0];
		expect(blob.type).toBe("text/csv;charset=utf-8");
		await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:typa/1"));
	});
});
