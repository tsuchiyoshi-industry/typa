// @vitest-environment happy-dom
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import { createSheetEditorPresenter } from "../presenters/SheetEditorPresenter";
import { showToast } from "./feedback";
import SheetEditorView from "./SheetEditorView";

vi.mock("./feedback", async (importOriginal) => ({
	...(await importOriginal<typeof import("./feedback")>()),
	showToast: vi.fn(),
}));
afterEach(cleanup);

const period = (id: number) =>
	({ id, periodName: `${id}期`, isActive: true }) as EvaluationPeriodDto;
const mine = (id: number, periodId: number) => ({ id, periodId }) as SheetSummaryDto;

/** 期間と自分のシートを、作成画面が読みに来たときに返す。 */
function setup(
	periods: EvaluationPeriodDto[],
	mySheets: SheetSummaryDto[],
	sheetsArrive: Promise<void> = Promise.resolve(),
) {
	const presenter = createRoot(() => createSheetEditorPresenter());
	const controller = {
		prepareNewSheet: () => presenter.prepareNewSheet(),
		loadPeriods: vi.fn(async () => presenter.outputPort.periods.present({ periods })),
		loadAccessibleSheets: vi.fn(async () => {
			presenter.beginAccessibleSheetsLoad();
			await sheetsArrive;
			presenter.outputPort.accessibleSheets.present({ mySheets, subordinateSheets: [] });
		}),
		setSelectedPeriod: (id: number | null) => presenter.setSelectedPeriodId(id),
		createSheet: vi.fn(async () => 900),
		// 作成後に開くシート。ここでは中身を確かめない
		loadSheet: vi.fn(),
	};
	const history = createMemoryHistory();
	history.set({ value: "/sheet/new", replace: true, scroll: false });
	const view = render(() => (
		<MemoryRouter history={history}>
			<Route
				path="/sheet/:id"
				component={() => (
					<SheetEditorView
						controller={controller as unknown as SheetEditorController}
						viewModel={presenter.viewModel}
						commonEvaluationController={{} as never}
						commonEvaluationViewModel={() => ({}) as never}
						challengeEvaluationController={{} as never}
						challengeEvaluationViewModel={() => ({}) as never}
					/>
				)}
			/>
		</MemoryRouter>
	));
	const create = () => view.getByRole("button", { name: "評価シートを作成" }) as HTMLButtonElement;
	return { ...view, controller, history, create };
}

it("offers only the active periods without my sheet", async () => {
	const view = setup([period(26), period(27)], [mine(5, 26)]);
	await waitFor(() => expect(view.create().disabled).toBe(false));
	const options = [...(view.getByLabelText(/評価対象期間/) as HTMLSelectElement).options]
		.filter((option) => !option.disabled)
		.map((option) => option.textContent);
	expect(options).toEqual(["27期"]);
	fireEvent.click(view.create());
	await waitFor(() => expect(view.history.get()).toBe("/sheet/900"));
	expect(showToast).toHaveBeenCalledWith("success", "評価シートを作成しました");
});

it("cannot create, and points to the existing sheet, when it is already created", async () => {
	const view = setup([period(26)], [mine(5, 26)]);
	const open = await view.findByRole("link", { name: "作成済みのシートを開く" });
	expect(open.getAttribute("href")).toBe("/sheet/5");
	expect(view.create().disabled).toBe(true);
	fireEvent.click(view.create());
	expect(view.controller.createSheet).not.toHaveBeenCalled();
	expect(showToast).not.toHaveBeenCalled();
});

it("cannot create until it knows which sheets I already have", async () => {
	let arrive = () => {};
	const view = setup([period(26)], [], new Promise<void>((resolve) => (arrive = resolve)));
	// 期間だけ届き、自分のシートはまだ読み込み中
	await waitFor(() => expect(view.getByRole("option", { name: "26期" })).toBeTruthy());
	expect(view.create().disabled).toBe(true);
	arrive();
	await waitFor(() => expect(view.create().disabled).toBe(false));
});
