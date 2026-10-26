import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationPeriodDto } from "../../application/dtos/EvaluationPeriodDto";
import { toEvaluationSheetDto } from "../../application/dtos/EvaluationSheetMapper";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import type {
	FetchEvaluationSheetInteractor,
	FetchEvaluationSheetOutputPort,
} from "../../application/usecases/FetchEvaluationSheetInteractor";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { employeeRepository, sheet } from "../../test/fixtures";
import { creatablePeriods, createSheetEditorPresenter } from "../presenters/SheetEditorPresenter";
import { SheetEditorController } from "./SheetEditorController";

const response = (id: number) => ({
	...toEvaluationSheetDto(sheet(), "技術1級", EvaluationSheetAccessPolicy.for(3, sheet())),
	sheetId: id,
});
it("ignores a late sheet response after the reviewer has moved to another person", async () => {
	const ports = new Map<number, FetchEvaluationSheetOutputPort>();
	const resolvers = new Map<number, () => void>();
	const useCase = {
		async execute(request: { sheetId: number }, port: FetchEvaluationSheetOutputPort) {
			ports.set(request.sheetId, port);
			await new Promise<void>((resolve) => resolvers.set(request.sheetId, resolve));
		},
	} as FetchEvaluationSheetInteractor;
	const presenter = createRoot(() => createSheetEditorPresenter());
	type Args = ConstructorParameters<typeof SheetEditorController>;
	const unused = {} as Args[1];
	const controller = new SheetEditorController(
		useCase,
		unused,
		{} as Args[2],
		{} as Args[3],
		{} as Args[4],
		{} as Args[5],
		presenter,
		employeeRepository(),
	);
	const first = controller.loadSheet(101);
	const second = controller.loadSheet(102);
	await Promise.resolve();
	ports.get(102)?.present(response(102));
	resolvers.get(102)?.();
	await second;
	ports.get(101)?.present(response(101));
	resolvers.get(101)?.();
	await first;
	expect(presenter.viewModel().sheet?.sheetId).toBe(102);
});
it("takes permissions from the sheet it shows, and drops them while another sheet loads", async () => {
	let present: (() => void) | undefined;
	const fetchCase = {
		async execute(_request: unknown, port: FetchEvaluationSheetOutputPort) {
			await new Promise<void>((resolve) => {
				present = () => {
					port.present(response(102));
					resolve();
				};
			});
		},
	} as FetchEvaluationSheetInteractor;
	const presenter = createRoot(() => createSheetEditorPresenter());
	// 3 は二次評価者。一次評価が確定したシートを確定できる
	const evaluated = sheet(EvaluationStatus.FIRST_EVALUATED);
	presenter.outputPort.sheet.present(
		toEvaluationSheetDto(evaluated, "技術1級", EvaluationSheetAccessPolicy.for(3, evaluated)),
	);
	expect(presenter.viewModel().canEditSecond).toBe(true);
	expect(presenter.viewModel().canFinalizeEvaluation).toBe(true);
	type Args = ConstructorParameters<typeof SheetEditorController>;
	const controller = new SheetEditorController(
		fetchCase,
		{} as Args[1],
		{} as Args[2],
		{} as Args[3],
		{} as Args[4],
		{} as Args[5],
		presenter,
		employeeRepository(),
	);
	const pending = controller.loadSheet(102);
	await Promise.resolve();
	expect(presenter.viewModel().canEditSecond).toBe(false);
	expect(presenter.viewModel().canFinalizeEvaluation).toBe(false);
	// 一次評価待ちのシートでは、二次評価者はまだ入力できない
	present?.();
	await pending;
	expect(presenter.viewModel().sheet?.sheetId).toBe(102);
	expect(presenter.viewModel().canEditSecond).toBe(false);
});

describe("新規作成", () => {
	const period = (id: number, isActive = true) =>
		({ id, periodName: `${id}期`, isActive }) as EvaluationPeriodDto;
	const mine = (periodId: number) => ({ id: periodId * 10, periodId }) as SheetSummaryDto;
	function setup(create = vi.fn(async (_request, port) => port.present({ sheetId: 900 }))) {
		const presenter = createRoot(() => createSheetEditorPresenter());
		type Args = ConstructorParameters<typeof SheetEditorController>;
		const controller = new SheetEditorController(
			{} as Args[0],
			{} as Args[1],
			{ execute: create } as unknown as Args[2],
			{} as Args[3],
			{} as Args[4],
			{} as Args[5],
			presenter,
			employeeRepository(),
		);
		const arrive = (periods: EvaluationPeriodDto[], mySheets: SheetSummaryDto[]) => {
			presenter.outputPort.periods.present({ periods });
			presenter.outputPort.accessibleSheets.present({ mySheets, subordinateSheets: [] });
		};
		return { presenter, controller, create, arrive };
	}

	it("offers only active periods that do not have my sheet yet", () => {
		const { presenter, arrive } = setup();
		arrive([period(25, false), period(26), period(27)], [mine(26)]);
		expect(creatablePeriods(presenter.viewModel()).map((p) => p.id)).toEqual([27]);
		expect(presenter.viewModel().selectedPeriodId).toBe(27);
	});

	it("moves the selection off a period once my sheet for it turns out to exist", () => {
		const { presenter } = setup();
		// 期間が先に届き、自分のシートが後から届く
		presenter.outputPort.periods.present({ periods: [period(26), period(27)] });
		expect(presenter.viewModel().selectedPeriodId).toBe(26);
		presenter.outputPort.accessibleSheets.present({ mySheets: [mine(26)], subordinateSheets: [] });
		expect(presenter.viewModel().selectedPeriodId).toBe(27);
	});

	it("selects nothing when every active period already has my sheet", async () => {
		const { presenter, controller, create, arrive } = setup();
		arrive([period(26)], [mine(26)]);
		expect(presenter.viewModel().selectedPeriodId).toBeNull();
		expect(await controller.createSheet()).toBeNull();
		expect(create).not.toHaveBeenCalled();
	});

	it("refuses to create for a period that already has my sheet, even if it is still selected", async () => {
		const { presenter, controller, create, arrive } = setup();
		arrive([period(26), period(27)], [mine(26)]);
		// 画面の状態が古いなどで、作成済みの期間が選ばれたまま押された
		presenter.setSelectedPeriodId(26);
		expect(await controller.createSheet()).toBeNull();
		expect(create).not.toHaveBeenCalled();
		expect(presenter.viewModel().createError).toBe("この評価期間の評価シートは作成済みです。");
	});

	it("creates once even when pressed twice, and shows that it is working meanwhile", async () => {
		let finish: (() => void) | undefined;
		const create = vi.fn(
			(_request: unknown, port: { present: (r: { sheetId: number }) => void }) =>
				new Promise<void>((resolve) => {
					finish = () => {
						port.present({ sheetId: 900 });
						resolve();
					};
				}),
		);
		const { presenter, controller, arrive } = setup(create);
		arrive([period(27)], []);
		const first = controller.createSheet();
		await vi.waitFor(() => expect(presenter.viewModel().creating).toBe(true));
		expect(await controller.createSheet()).toBeNull();
		finish?.();
		expect(await first).toBe(900);
		expect(create).toHaveBeenCalledTimes(1);
		expect(presenter.viewModel().creating).toBe(false);
	});

	it("lets the user try again after creation fails", async () => {
		const create = vi
			.fn()
			.mockRejectedValueOnce(new Error("評価シートを作成できるのは、実施中の評価期間だけです。"));
		const { presenter, controller, arrive } = setup(create);
		arrive([period(27)], []);
		expect(await controller.createSheet()).toBeNull();
		expect(presenter.viewModel().creating).toBe(false);
		expect(presenter.viewModel().createError).toBe(
			"評価シートを作成できるのは、実施中の評価期間だけです。",
		);
	});
});
