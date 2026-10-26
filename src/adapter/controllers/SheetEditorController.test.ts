import { createRoot } from "solid-js";
import { expect, it } from "vitest";
import { toEvaluationSheetDto } from "../../application/dtos/EvaluationSheetMapper";
import type {
	FetchEvaluationSheetInteractor,
	FetchEvaluationSheetOutputPort,
} from "../../application/usecases/FetchEvaluationSheetInteractor";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { employeeRepository, sheet } from "../../test/fixtures";
import { createSheetEditorPresenter } from "../presenters/SheetEditorPresenter";
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
