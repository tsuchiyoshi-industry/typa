import { expect, it } from "vitest";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { milestoneRepository, output, sheet, sheetRepository } from "../../test/fixtures";
import { CarryOverGoalInteractor } from "./CarryOverGoalInteractor";

function setup(status = EvaluationStatus.DRAFT, periodClosed = false) {
	const sheets = sheetRepository();
	sheets.findById.mockResolvedValue(sheet(status, undefined, periodClosed));
	const milestones = milestoneRepository();
	const out = output<{ goalNumber: number }>();
	return { useCase: new CarryOverGoalInteractor(sheets, milestones), milestones, sheets, out };
}

it("carries a previous challenge goal into the subject's draft and tells where it went", async () => {
	const { useCase, milestones, out } = setup();
	await useCase.execute({ sheetId: 100, currentEmployeeId: 1, previousGoalId: 7 }, out);
	expect(milestones.carryOver).toHaveBeenCalledExactlyOnceWith(100, 7);
	expect(out.present).toHaveBeenCalledWith({ goalNumber: 2 });
});

it.each([
	["an evaluator", EvaluationStatus.DRAFT, 2, false],
	["someone unrelated", EvaluationStatus.DRAFT, 4, false],
	["the subject after sending the goals", EvaluationStatus.GOALS_SUBMITTED, 1, false],
	["the subject after the goals are confirmed", EvaluationStatus.GOALS_CONFIRMED, 1, false],
	["the subject in a closed period", EvaluationStatus.DRAFT, 1, true],
] as const)("refuses %s without writing", async (_, status, id, closed) => {
	const { useCase, milestones, out } = setup(status, closed);
	expect(
		await useCase.execute({ sheetId: 100, currentEmployeeId: id, previousGoalId: 7 }, out),
	).toMatchObject({
		ok: false,
		error: closed ? { kind: "periodClosed" } : { kind: "forbidden", action: "carryOverGoal" },
	});
	expect(milestones.carryOver).not.toHaveBeenCalled();
	expect(out.present).not.toHaveBeenCalled();
});

it("refuses a sheet it cannot find, and a malformed goal id", async () => {
	const { useCase, sheets, milestones, out } = setup();
	for (const previousGoalId of [0, -1, 1.5, Number.NaN]) {
		expect(
			await useCase.execute({ sheetId: 100, currentEmployeeId: 1, previousGoalId }, out),
		).toMatchObject({ ok: false, error: { kind: "previousGoalInvalid" } });
	}
	sheets.findById.mockResolvedValue(null);
	expect(
		await useCase.execute({ sheetId: 100, currentEmployeeId: 1, previousGoalId: 7 }, out),
	).toMatchObject({ ok: false, error: { kind: "sheetNotFound" } });
	expect(milestones.carryOver).not.toHaveBeenCalled();
});
