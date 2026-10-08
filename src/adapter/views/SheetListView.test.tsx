// @vitest-environment jsdom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import type { SheetListController } from "../controllers/SheetListController";
import type { SheetListViewModel } from "../presenters/SheetListPresenter";
import SheetListView from "./SheetListView";

afterEach(cleanup);

const sheet = (id: number, period: 25 | 26, employeeName: string): SheetSummaryDto => ({
	id,
	periodId: period,
	employeeId: id,
	status: period === 25 ? "finalized" : "submitted",
	totalScore: null,
	createdAt: "2026-04-01T00:00:00Z",
	updatedAt: "2026-04-01T00:00:00Z",
	periodName: `${period}期`,
	startDate: period === 25 ? "2025-03-24" : "2026-03-23",
	endDate: period === 25 ? "2026-03-22" : "2027-02-19",
	employeeName,
	employeeNo: `E00${id}`,
	gradeName: "総合Ⅱ級",
});

it("puts my sheets and my reports' sheets under evaluation period tabs, newest period first", async () => {
	const viewModel: SheetListViewModel = {
		loading: false,
		mySheets: [sheet(1, 25, "自分"), sheet(2, 26, "自分")],
		subordinateSheets: [sheet(3, 25, "社員A"), sheet(4, 26, "社員B"), sheet(5, 26, "社員C")],
		errorMessage: null,
		exportStatus: { isExporting: false, message: null, success: null, fileName: null },
	};
	const view = render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<SheetListView
						controller={{ load: vi.fn(), exportSheet: vi.fn() } as unknown as SheetListController}
						viewModel={() => viewModel}
					/>
				)}
			/>
		</MemoryRouter>
	));
	const tabs = within(await view.findByRole("navigation", { name: "評価期間" })).getAllByRole(
		"button",
	);
	expect(tabs.map((tab) => tab.textContent)).toEqual(["26期3 件", "25期2 件"]);
	expect(tabs[0].getAttribute("aria-pressed")).toBe("true");
	expect(view.getByText("社員B")).toBeTruthy();
	expect(view.queryByText("社員A")).toBeNull();
	// 期間はタブで分かるので、表に評価期間の列は出さない
	expect(view.queryByRole("columnheader", { name: "評価期間" })).toBeNull();
	// 自分のシートは氏名の列がないので、等級が開くためのリンクになる
	expect(view.getByRole("link", { name: "総合Ⅱ級" }).getAttribute("href")).toBe("/sheet/2");

	fireEvent.click(tabs[1]);
	expect(view.getByText("社員A")).toBeTruthy();
	expect(view.queryByText("社員B")).toBeNull();
	expect(view.getAllByText("最終評価済み")).toHaveLength(2);
	expect(view.getByRole("link", { name: "総合Ⅱ級" }).getAttribute("href")).toBe("/sheet/1");
});
