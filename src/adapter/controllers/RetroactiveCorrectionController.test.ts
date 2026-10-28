import { expect, it, vi } from "vitest";
import { PrivilegedSheetOperationInteractor } from "../../application/usecases/PrivilegedSheetOperationInteractor";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { masterRepository, period, profile, sheetRepository } from "../../test/fixtures";
import { RetroactiveCorrectionController } from "./RetroactiveCorrectionController";

const closed = EvaluationPeriod.restore({
	id: 9,
	termName: "25期",
	startDate: "2025-10-01",
	endDate: "2026-03-31",
	isActive: false,
	isClosed: true,
	allowUnfinalizedClose: false,
});

const setup = (role = "Admin") => {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role));
	const periods = { findDistinctPeriods: vi.fn().mockResolvedValue([closed, period()]) };
	const repository = { execute: vi.fn().mockResolvedValue(undefined) };
	const controller = new RetroactiveCorrectionController(
		employees,
		periods,
		sheetRepository(),
		{ findClosedSheet: vi.fn() },
		{ execute: vi.fn() } as never,
		new PrivilegedSheetOperationInteractor(repository, employees),
	);
	return { periods, repository, controller };
};

it("refuses the page to a non-Admin before reading any period, even by direct URL", async () => {
	const { controller, periods } = setup("Reviewer");
	await expect(controller.periods()).rejects.toThrow("Admin");
	expect(periods.findDistinctPeriods).not.toHaveBeenCalled();
});

it("offers every period, newest first, with whether its values can still be corrected", async () => {
	const { controller } = setup();
	expect((await controller.periods()).map((entry) => [entry.id, entry.state])).toEqual([
		[10, "active"],
		[9, "closed"],
	]);
});

it("returns typed business failures and preserves a server error for the operator", async () => {
	const { controller, repository } = setup();
	const request = {
		sheetId: 100,
		expectedStatus: "finalized",
		action: "delete",
		reason: "再現テスト",
	};
	expect(await controller.operate({ ...request, reason: "" })).toEqual({
		success: false,
		message: "操作の理由を 500 文字以内で入力してください。",
	});
	expect(repository.execute).not.toHaveBeenCalled();
	repository.execute.mockRejectedValueOnce(new Error("シートの状態が変わりました"));
	expect(await controller.operate(request)).toEqual({
		success: false,
		message: "シートの状態が変わりました",
	});
	expect((await controller.operate(request)).success).toBe(true);
});
