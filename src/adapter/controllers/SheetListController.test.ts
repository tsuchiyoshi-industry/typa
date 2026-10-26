import { createRoot } from "solid-js";
import { expect, it, vi } from "vitest";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import { createSheetListPresenter } from "../presenters/SheetListPresenter";
import { SheetListController } from "./SheetListController";

type Args = ConstructorParameters<typeof SheetListController>;
const period = (id: number, isActive: boolean) => ({ id, isActive }) as EvaluationPeriodDto;

function setup(fetchPeriods: () => Promise<EvaluationPeriodDto[]>) {
	const presenter = createRoot(() => createSheetListPresenter());
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
		{
			execute: vi.fn(async (_request, port) => port.present({ sheets: [] })),
		} as unknown as Args[6],
		presenter.overviewOutputPort,
		{} as Args[8],
		{
			execute: vi.fn(async (_request, port) => port.present({ periods: await fetchPeriods() })),
		} as unknown as Args[9],
		presenter.periodsOutputPort,
	);
	return { presenter, controller };
}

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
