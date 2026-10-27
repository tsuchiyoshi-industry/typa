import { expect, it, vi } from "vitest";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { employeeRepository, output, sheet, sheetRepository } from "../../test/fixtures";
import {
	describeUpdateEvaluationStatusError,
	UpdateEvaluationStatusInteractor,
} from "./UpdateEvaluationStatusInteractor";

function setup() {
	const sheets = sheetRepository();
	sheets.findById.mockResolvedValue(sheet(EvaluationStatus.GOALS_SUBMITTED));
	const notifications = { notifySheetStatusChanged: vi.fn().mockResolvedValue(undefined) };
	const useCase = new UpdateEvaluationStatusInteractor(sheets, employeeRepository(), notifications);
	const out = output<never>();
	const returnGoals = (returnReason: string | undefined, currentEmployeeId = 2) =>
		useCase.execute(
			{ sheetId: 100, status: EvaluationStatus.DRAFT, currentEmployeeId, returnReason },
			out,
		);
	return { sheets, notifications, out, returnGoals };
}

it("returns the goals with the trimmed reason and tells nobody the sheet content", async () => {
	const { sheets, notifications, out, returnGoals } = setup();
	expect(await returnGoals("  数値目標を入れてください\n")).toEqual({ ok: true, value: undefined });
	expect(sheets.returnGoals).toHaveBeenCalledWith(100, expect.anything());
	expect(String(sheets.returnGoals.mock.calls[0][1])).toBe("数値目標を入れてください");
	expect(sheets.updateStatus).not.toHaveBeenCalled();
	// 戻した評価者はもう読めない
	expect(out.present).toHaveBeenCalledWith({ sheet: null });
	expect(notifications.notifySheetStatusChanged).toHaveBeenCalled();
});

it.each([
	["missing", undefined],
	["blank", " 　\n"],
	["over 200 characters", "あ".repeat(201)],
])("refuses a return whose reason is %s before writing or notifying", async (_case, reason) => {
	const { sheets, notifications, out, returnGoals } = setup();
	const result = await returnGoals(reason);
	expect(result).toEqual({ ok: false, error: { kind: "returnReasonInvalid", max: 200 } });
	expect(!result.ok && describeUpdateEvaluationStatusError(result.error)).toBe(
		"差し戻しの理由を 200 文字以内で入力してください。",
	);
	expect(sheets.returnGoals).not.toHaveBeenCalled();
	expect(sheets.updateStatus).not.toHaveBeenCalled();
	expect(notifications.notifySheetStatusChanged).not.toHaveBeenCalled();
	expect(out.present).not.toHaveBeenCalled();
});

it("refuses someone who may not return the goals, whatever the reason", async () => {
	const { sheets, returnGoals } = setup();
	expect(await returnGoals("理由", 1)).toMatchObject({
		ok: false,
		error: { kind: "transitionForbidden" },
	});
	expect(sheets.returnGoals).not.toHaveBeenCalled();
});
