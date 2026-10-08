import { createRoot } from "solid-js";
import { expect, it } from "vitest";
import { toEvaluationSheetDto } from "../../application/dtos/EvaluationSheetMapper";
import type {
	CheckEvaluatorRoleInteractor,
	CheckEvaluatorRoleOutputPort,
} from "../../application/usecases/CheckEvaluatorRoleInteractor";
import type {
	FetchEvaluationSheetInteractor,
	FetchEvaluationSheetOutputPort,
} from "../../application/usecases/FetchEvaluationSheetInteractor";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
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
		{} as Args[6],
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
it("resets edit permissions on navigation and rejects late permissions for the previous sheet", async () => {
	let oldPort: CheckEvaluatorRoleOutputPort | undefined;
	let finish: (() => void) | undefined;
	const roleCase = {
		async execute(_request: unknown, port: CheckEvaluatorRoleOutputPort) {
			oldPort = port;
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
	} as CheckEvaluatorRoleInteractor;
	const presenter = createRoot(() => createSheetEditorPresenter());
	presenter.outputPort.sheet.present(response(101));
	const permissions = {
		isSubject: false,
		viewingAsAdmin: false,
		canEditFirst: false,
		canEditSecond: true,
		canEditMilestoneGoal: false,
		canViewCommonEvaluation: true,
		canViewSecondEvaluation: true,
		canSubmitOwnSheet: false,
		canRevertOwnSheetToDraft: false,
		canConfirmFirstEvaluation: false,
		canFinalizeEvaluation: true,
	};
	presenter.outputPort.role.present(permissions);
	type Args = ConstructorParameters<typeof SheetEditorController>;
	const fetchCase = {
		async execute(_request: unknown, port: FetchEvaluationSheetOutputPort) {
			port.present(response(102));
		},
	} as FetchEvaluationSheetInteractor;
	const controller = new SheetEditorController(
		fetchCase,
		{} as Args[1],
		{} as Args[2],
		roleCase,
		{} as Args[4],
		{} as Args[5],
		{} as Args[6],
		presenter,
		employeeRepository(),
	);
	const pending = controller.loadRoles(101);
	await controller.loadSheet(102);
	expect(presenter.viewModel().canEditSecond).toBe(false);
	oldPort?.present(permissions);
	finish?.();
	await pending;
	expect(presenter.viewModel().canEditSecond).toBe(false);
	expect(presenter.viewModel().canFinalizeEvaluation).toBe(false);
});
