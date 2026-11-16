import { expect, it, vi } from "vitest";
import { ImportSheetDataInteractor } from "../../application/usecases/ImportSheetDataInteractor";
import { CSV_HEADERS } from "../../application/usecases/sheetImportCsv";
import type { SheetImportRepository } from "../../domain/repositories/SheetImportRepository";
import { masterRepository, periodRepository, profile } from "../../test/fixtures";
import { SheetImportController } from "./SheetImportController";

const setup = (actor = profile("Admin")) => {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(actor);
	const periods = periodRepository();
	const repository = {
		findTemplate: vi.fn<SheetImportRepository["findTemplate"]>(),
		importRows: vi.fn<SheetImportRepository["importRows"]>().mockResolvedValue({
			errors: [],
			summary: null,
			applied: true,
		}),
	};
	const controller = new SheetImportController(
		employees,
		periods,
		repository,
		new ImportSheetDataInteractor(repository),
		{ selectDestination: vi.fn(), save: vi.fn() },
	);
	return { controller, periods, repository };
};
const goalsFile = () =>
	new File([`${CSV_HEADERS.goals.join(",")}\nE1,社員1,1,目標,,,,\n`], "goals.csv");

it("offers the period in progress and the closed ones, marking those that need a confirmation", async () => {
	// fixtures: 1 前期(締め済み) / 2 今期(実施中) / 3 来期(未開始)
	expect(await setup().controller.periods()).toEqual([
		{ id: 2, periodName: "今期", stateLabel: "実施中", needsConfirmation: false },
		{ id: 1, periodName: "前期", stateLabel: "締め済み", needsConfirmation: true },
	]);
});

it.each([
	["an evaluator", profile("Reviewer")],
	["an employee", profile("Employee")],
	["a suspended Admin", profile("Admin", 1, true, false)],
	["someone without an employee record", null],
])(
	"refuses %s before reading any period, even when the URL is opened directly",
	async (_, actor) => {
		const { controller, periods, repository } = setup(actor as ReturnType<typeof profile>);
		await expect(controller.periods()).rejects.toThrow("データ取込は Admin のみ利用できます。");
		expect(periods.findDistinctPeriods).not.toHaveBeenCalled();
		expect(repository.findTemplate).not.toHaveBeenCalled();
	},
);

it("loads the template of the chosen period", async () => {
	const { controller, repository } = setup();
	await controller.loadTemplate(1);
	expect(repository.findTemplate).toHaveBeenCalledWith(1);
});

it("sends the chosen period and whether the Admin confirmed its close", async () => {
	const { controller, repository } = setup();
	await controller.run({
		periodId: 1,
		closedPeriodConfirmed: true,
		goals: goalsFile(),
		common: null,
		apply: true,
	});
	expect(repository.importRows).toHaveBeenCalledWith(
		expect.objectContaining({ periodId: 1, closedPeriodConfirmed: true, apply: true }),
	);
});

it("reports a failure on the way to the database instead of crashing", async () => {
	const { controller, repository } = setup();
	repository.importRows.mockRejectedValue(
		new Error("「前期」は締め済みの評価期間です。画面を読み込み直し、"),
	);
	expect(
		await controller.run({
			periodId: 1,
			closedPeriodConfirmed: false,
			goals: goalsFile(),
			common: null,
			apply: true,
		}),
	).toEqual({
		errors: [
			{ file: null, line: null, message: "「前期」は締め済みの評価期間です。画面を読み込み直し、" },
		],
		summary: null,
		applied: false,
	});
});
