import { expect, it, vi } from "vitest";
import { PrivilegedSheetOperationInteractor } from "../../application/usecases/PrivilegedSheetOperationInteractor";
import { masterRepository, period, profile, sheetRepository } from "../../test/fixtures";
import { PrivilegedOperationsController } from "./PrivilegedOperationsController";

const setup = (role = "Admin") => {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role));
	const periods = { findDistinctPeriods: vi.fn().mockResolvedValue([period(false), period()]) };
	const sheets = sheetRepository();
	const repository = { execute: vi.fn().mockResolvedValue(undefined) };
	const controller = new PrivilegedOperationsController(
		employees,
		periods,
		sheets,
		new PrivilegedSheetOperationInteractor(repository, employees),
	);
	return { employees, periods, sheets, repository, controller };
};
it("denies the direct page URL before loading periods for a non-Admin", async () => {
	const { controller, periods } = setup("Reviewer");
	await expect(controller.periods()).rejects.toThrow("Admin");
	expect(periods.findDistinctPeriods).not.toHaveBeenCalled();
});
it("offers both active and closed periods", async () => {
	const { controller } = setup();
	expect((await controller.periods()).map((entry) => entry.state)).toEqual(["closed", "active"]);
});
it("returns typed business failures and preserves a server error for the operator", async () => {
	const { controller, repository } = setup();
	const request = {
		sheetId: 100,
		expectedStatus: "finalized",
		action: "delete",
		reason: "再現テスト",
	};
	expect(await controller.execute({ ...request, reason: "" })).toEqual({
		success: false,
		message: "操作の理由を 500 文字以内で入力してください。",
	});
	expect(repository.execute).not.toHaveBeenCalled();
	repository.execute.mockRejectedValueOnce(new Error("シートの状態が変わりました"));
	expect(await controller.execute(request)).toEqual({
		success: false,
		message: "シートの状態が変わりました",
	});
	expect((await controller.execute(request)).success).toBe(true);
});
