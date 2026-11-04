import { createRoot } from "solid-js";
import { expect, it, vi } from "vitest";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import { createSheetListPresenter } from "../presenters/SheetListPresenter";
import { SheetListController } from "./SheetListController";

type Args = ConstructorParameters<typeof SheetListController>;
const period = (id: number, isActive: boolean) => ({ id, isActive }) as EvaluationPeriodDto;

const index = {
	periods: [{ id: 26, name: "26期", startDate: "2026-03-23" }],
	sheets: [{ id: 1, periodId: 26, employeeId: 4 }],
};

function setup(
	fetchPeriods: () => Promise<EvaluationPeriodDto[]>,
	fetchIndex: () => Promise<typeof index | null> = async () => index,
) {
	const presenter = createRoot(() => createSheetListPresenter());
	// その評価期間のシートを1枚返す(期間 ID をシートの ID にする)
	const overview = {
		execute: vi.fn(async (request: { periodId: number }, port) =>
			port.present({ periodId: request.periodId, sheets: [{ id: request.periodId }] }),
		),
	};
	const indexUseCase = {
		execute: vi.fn(async (_request, port) => port.present({ index: await fetchIndex() })),
	};
	const controller = new SheetListController(
		{
			execute: vi.fn(async (_request, port) =>
				port.present({ mySheets: [], subordinateSheets: [] }),
			),
		} as unknown as Args[0],
		presenter.fetchOutputPort,
		{} as Args[2],
		presenter.exportOutputPort,
		presenter.presentError,
		{} as Args[5],
		overview as unknown as Args[6],
		presenter.overviewOutputPort,
		{} as Args[8],
		{
			execute: vi.fn(async (_request, port) => port.present({ periods: await fetchPeriods() })),
		} as unknown as Args[9],
		presenter.periodsOutputPort,
		indexUseCase as unknown as Args[11],
		presenter.indexOutputPort,
	);
	return { presenter, controller, overview, indexUseCase };
}

it("reads only the index of the company-wide sheets on opening, not their contents", async () => {
	const { presenter, controller, overview } = setup(async () => []);
	await controller.load();
	expect(presenter.viewModel().overviewIndex).toEqual(index);
	expect(overview.execute).not.toHaveBeenCalled();
});

it("reads the company-wide sheets one period at a time, and keeps each period apart", async () => {
	const { presenter, controller, overview } = setup(async () => []);
	await controller.load();
	await controller.loadOverview(26);
	await controller.loadOverview(25);
	expect(overview.execute.mock.calls.map(([request]) => request)).toEqual([
		{ periodId: 26 },
		{ periodId: 25 },
	]);
	expect(presenter.viewModel().overviewSheets).toEqual({ 26: [{ id: 26 }], 25: [{ id: 25 }] });
});

it("re-reads the period that was open when the list is reloaded", async () => {
	const { controller, overview } = setup(async () => []);
	await controller.load();
	await controller.loadOverview(26);
	await controller.load();
	expect(overview.execute).toHaveBeenLastCalledWith({ periodId: 26 }, expect.anything());
	expect(overview.execute).toHaveBeenCalledTimes(2);
});

it("leaves no index for someone who may not see the company-wide sheets", async () => {
	const { presenter, controller } = setup(
		async () => [],
		async () => null,
	);
	await controller.load();
	expect(presenter.viewModel().overviewIndex).toBeNull();
});

it("keeps my own sheets and reports the error when the index cannot be read", async () => {
	const { presenter, controller } = setup(
		async () => [],
		() => Promise.reject(new Error("offline")),
	);
	await controller.load();
	expect(presenter.viewModel().loading).toBe(false);
	expect(presenter.viewModel().errorMessage).toBe("offline");
	expect(presenter.viewModel().overviewIndex).toBeNull();
});

it("does not know the active periods until they are read", () => {
	const { presenter } = setup(async () => []);
	expect(presenter.viewModel().activePeriodIds).toBeUndefined();
});

it("keeps only the active periods, where a sheet can be created", async () => {
	const { presenter, controller } = setup(async () => [
		period(25, false),
		period(26, true),
		period(27, false),
	]);
	await controller.load();
	expect(presenter.viewModel().activePeriodIds).toEqual([26]);
});

it("keeps the sheet list without an error message when the periods cannot be read", async () => {
	const { presenter, controller } = setup(() => Promise.reject(new Error("offline")));
	await controller.load();
	// 一覧は出したまま。期間が分からないことは null で示し、作成画面に確かめを任せる
	expect(presenter.viewModel().loading).toBe(false);
	expect(presenter.viewModel().errorMessage).toBeNull();
	expect(presenter.viewModel().activePeriodIds).toBeNull();
});
