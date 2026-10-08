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

const setup = (overviewSheets: SheetListViewModel["overviewSheets"]) => {
	const viewModel: SheetListViewModel = {
		loading: false,
		mySheets: [sheet(1, 25, "自分"), sheet(2, 26, "自分")],
		subordinateSheets: [sheet(3, 25, "社員A"), sheet(4, 26, "社員B"), sheet(5, 26, "社員C")],
		overviewSheets,
		errorMessage: null,
		exportStatus: { isExporting: false, message: null, success: null, fileName: null },
	};
	const controller = { load: vi.fn(), exportSheet: vi.fn(), exportOverview: vi.fn() };
	const view = render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<SheetListView
						controller={controller as unknown as SheetListController}
						viewModel={() => viewModel}
					/>
				)}
			/>
		</MemoryRouter>
	));
	return { ...view, controller };
};

it("puts my sheets and my reports' sheets under evaluation period tabs, newest period first", async () => {
	const view = setup(null);
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
	// Admin 以外には、全社の一覧を出さない
	expect(view.queryByRole("heading", { name: /全社の評価シート/ })).toBeNull();
});

it("adds the company-wide overview for an Admin below the two tables, as a table to look at, not to open", async () => {
	const everyone = (
		id: number,
		period: 25 | 26,
		name: string,
		status: SheetSummaryDto["status"],
	) => ({
		...sheet(id, period, name),
		status,
		primaryEvaluator: "井上 部長",
		secondaryEvaluator: id === 9 ? "なし" : "松本 本部長",
		finalScore: status === "finalized" ? 88 : null,
		finalRank: status === "finalized" ? "B+" : null,
	});
	const view = setup([
		// 自分(2)と部下(4)のシートも全社の一覧に含まれる
		everyone(2, 26, "自分", "submitted"),
		everyone(4, 26, "社員B", "submitted"),
		everyone(8, 26, "他部署X", "draft"),
		everyone(9, 26, "他部署Y", "finalized"),
		{ ...everyone(7, 24 as 25, "退職者Z", "finalized"), startDate: "2024-03-25" },
	]);
	const tabs = within(await view.findByRole("navigation", { name: "評価期間" })).getAllByRole(
		"button",
	);
	// 同じシートは二重に数えない。自分にも部下にもシートのない期間も、Admin には選べる
	expect(tabs.map((tab) => tab.textContent)).toEqual(["26期5 件", "25期2 件", "24期1 件"]);

	const headings = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
	expect(headings).toEqual(["自分の評価シート", "部下の評価シート", "全社の評価シートAdmin"]);
	const overview = view
		.getByRole("heading", { name: /全社の評価シート/ })
		.closest("section") as HTMLElement;
	expect(within(overview).getAllByRole("row")).toHaveLength(1 + 4);
	expect(within(overview).getByRole("columnheader", { name: "二次評価者" })).toBeTruthy();
	expect(within(overview).getByText("なし")).toBeTruthy();
	// 俯瞰するための表。行は押せず、シートへのリンクも、行ごとの PDF 出力もない
	expect(within(overview).queryAllByRole("link")).toEqual([]);
	expect(within(overview).queryByRole("button", { name: "PDF出力" })).toBeNull();
	const finalized = within(overview).getByText("他部署Y").closest("tr") as HTMLElement;
	expect(finalized.textContent).toContain("88 点 B+");
	expect(finalized.classList.contains("sheet-row")).toBe(false);
	fireEvent.click(finalized);
	expect(view.controller.exportSheet).not.toHaveBeenCalled();

	// 段ごとの件数が、そのまま絞り込みになる。シートのない段は押せない
	const stage = (name: RegExp) => within(overview).getByRole("button", { name });
	expect((stage(/二次評価待ち/) as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(stage(/一次評価待ち\s*2/));
	expect(within(overview).getAllByRole("row")).toHaveLength(1 + 2);
	expect(within(overview).queryByText("他部署X")).toBeNull();
	fireEvent.click(stage(/一次評価待ち\s*2/));
	expect(within(overview).getByText("他部署X")).toBeTruthy();

	fireEvent.click(within(overview).getByRole("button", { name: "一覧をPDF出力" }));
	expect(view.controller.exportOverview).toHaveBeenCalledExactlyOnceWith(26);
});
