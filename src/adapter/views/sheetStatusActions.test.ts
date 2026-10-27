// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import { pendingConfirm, settleConfirm } from "./feedback";
import { createSheetStatusActions } from "./sheetStatusActions";

function setup(updateResults: boolean[] = []) {
	let sheetId = 101;
	const updateStatus = vi.fn(async () => updateResults.shift() ?? true);
	const actions = createSheetStatusActions({
		controller: { updateStatus } as unknown as SheetEditorController,
		viewModel: () =>
			({
				sheet: { sheetId, subject: { name: `社員${sheetId}` }, notifiesByMail: false },
				statusUpdateError: null,
			}) as unknown as SheetEditorViewModel,
		ensureEvaluationComplete: () => true,
	});
	/** 差し戻しのダイアログを開き、入っていた理由を返す。text を書いて、confirm なら実行する。 */
	const open = async (text?: string, confirm = false) => {
		const done = actions.returnGoals();
		const request = pendingConfirm();
		const initial = request?.text?.initial ?? "";
		if (text !== undefined) {
			request?.text?.onInput(text);
		}
		settleConfirm(confirm);
		await done;
		// 失敗したときの「変更できませんでした」を閉じる
		if (pendingConfirm()) {
			settleConfirm(true);
		}
		return initial;
	};
	return { open, updateStatus, switchTo: (id: number) => (sheetId = id) };
}

it("reopens with the reason written for the same sheet, but not for another subordinate's", async () => {
	const { open, switchTo, updateStatus } = setup();
	expect(await open("社員101さんへの理由")).toBe("");
	expect(await open()).toBe("社員101さんへの理由");
	switchTo(102);
	expect(await open()).toBe("");
	expect(updateStatus).not.toHaveBeenCalled();
});

it("keeps the reason after a failed return and forgets it after a successful one", async () => {
	const { open, updateStatus } = setup([false, true]);
	await open("理由A", true);
	expect(updateStatus).toHaveBeenLastCalledWith(expect.anything(), true, "理由A");
	expect(await open(undefined, true)).toBe("理由A");
	expect(await open()).toBe("");
});
