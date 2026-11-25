import { createRoot, flush } from "solid-js";
import { expect, it } from "vitest";
import { createEmployeeMasterPresenter } from "./EmployeeMasterPresenter";

const presenter = () => createRoot(() => createEmployeeMasterPresenter());
// Solid 2 は書き込みを次のマイクロタスクで反映する。presenter に書いたら反映してから読む
const read = (view: ReturnType<typeof presenter>) => {
	flush();
	return view.viewModel();
};
const invitation = { employeeNo: "E2", name: "社員2", code: "ABCD-EFGH", expiresAt: "2026-11-06" };

it("hides the invitation codes once someone's use is stopped, but keeps them when that failed", () => {
	const view = presenter();
	view.outputPort.issueInvitation.present({
		success: true,
		message: "発行しました",
		invitations: [invitation],
	});
	expect(read(view).invitations).toEqual([invitation]);
	view.outputPort.updateEnabled.present({ success: false, message: "できませんでした" });
	expect(read(view).invitations).toEqual([invitation]);
	view.outputPort.updateEnabled.present({ success: true, message: "停止しました" });
	expect(read(view).invitations).toEqual([]);
	expect(read(view).updateStatus).toEqual({ message: "停止しました", success: true });
});

it("keeps the list it had when a reload fails, and clears the error on the next load", () => {
	const view = presenter();
	view.outputPort.load.present({
		currentEmployee: null,
		mode: "admin",
		canEditEvaluators: true,
		canEditGrades: true,
		canEditRoles: true,
		canResetRegistrations: true,
		relations: [{ employeeNo: "E2" } as never],
		grades: [],
	});
	view.beginLoad();
	expect(read(view).loading).toBe(true);
	view.presentError("社員マスタの取得に失敗しました");
	expect(read(view)).toMatchObject({
		loading: false,
		errorMessage: "社員マスタの取得に失敗しました",
		relations: [{ employeeNo: "E2" }],
	});
	view.beginLoad();
	expect(read(view).errorMessage).toBeNull();
});
