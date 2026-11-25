// @vitest-environment happy-dom

import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { routed } from "../../test/router";
import { testSignal } from "../../test/signal";
import type { SheetListController } from "../controllers/SheetListController";
import type { SheetListViewModel } from "../presenters/SheetListPresenter";

const mocks = vi.hoisted(() => ({ tauri: false, showToast: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri }));
vi.mock("./feedback", async (original) => ({
	...(await original<typeof import("./feedback")>()),
	showToast: mocks.showToast,
}));

import SheetListView from "./SheetListView";

afterEach(cleanup);
beforeEach(() => mocks.showToast.mockClear());

const exportPdf = () => {
	const [viewModel, setViewModel] = testSignal<SheetListViewModel>({
		loading: false,
		activePeriodIds: [],
		mySheets: [],
		subordinateSheets: [],
		overviewIndex: null,
		overviewSheets: {},
		errorMessage: null,
		exportStatus: { isExporting: false, message: null, success: null, fileName: null },
	});
	const controller = { load: vi.fn(), exportSheet: vi.fn(), exportOverview: vi.fn() };
	render(() =>
		routed(() => (
			<SheetListView
				controller={controller as unknown as SheetListController}
				viewModel={viewModel}
			/>
		)),
	);
	setViewModel((current) => ({
		...current,
		exportStatus: {
			isExporting: false,
			message: "PDFの出力に成功しました",
			success: true,
			fileName: "評価シート.pdf",
		},
	}));
	return mocks.showToast.mock.calls[mocks.showToast.mock.calls.length - 1];
};

it("offers to open the folder of the saved PDF in the desktop app", () => {
	mocks.tauri = true;
	const [kind, title, detail, action] = exportPdf() ?? [];
	expect([kind, title, detail]).toEqual(["success", "PDFを保存しました", "評価シート.pdf"]);
	expect(action?.label).toBe("フォルダを開く");
});

it("only says the PDF was downloaded in the browser, which cannot open folders", () => {
	mocks.tauri = false;
	const [kind, title, detail, action] = exportPdf() ?? [];
	expect([kind, title, detail]).toEqual(["success", "PDFをダウンロードしました", "評価シート.pdf"]);
	expect(action).toBeUndefined();
});
