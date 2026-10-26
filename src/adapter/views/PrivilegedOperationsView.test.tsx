// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { PrivilegedOperationsController } from "../controllers/PrivilegedOperationsController";
import { confirmAction } from "./feedback";
import PrivilegedOperationsView from "./PrivilegedOperationsView";

vi.mock("./feedback", () => ({ confirmAction: vi.fn(), showToast: vi.fn() }));
afterEach(cleanup);
const setup = () => {
	const controller = {
		periods: vi
			.fn()
			.mockResolvedValue([{ id: 2, periodName: "25期", stateLabel: "締め済み", isActive: false }]),
		sheets: vi
			.fn()
			.mockResolvedValue([
				{ sheetId: 200, employeeName: "社員4", employeeNo: "E4", status: "finalized" },
			]),
		execute: vi.fn().mockResolvedValue({ success: true, message: "記録しました" }),
	};
	const view = render(() => (
		<PrivilegedOperationsView
			controller={controller as unknown as PrivilegedOperationsController}
		/>
	));
	return { controller, view };
};
const choose = async (view: ReturnType<typeof render>) => {
	fireEvent.change(await view.findByLabelText("対象シート"), { target: { value: "200" } });
	fireEvent.input(view.getByLabelText("操作の理由"), { target: { value: "再現テスト" } });
};
it("selects a closed period and confirms the exact status change before writing", async () => {
	const { controller, view } = setup();
	await choose(view);
	fireEvent.change(view.getByLabelText("変更後の状態"), { target: { value: "draft" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(view.getByRole("button", { name: "操作内容を確認" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalled());
	expect(controller.execute).not.toHaveBeenCalled();
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(view.getByRole("button", { name: "操作内容を確認" }));
	await waitFor(() =>
		expect(controller.execute).toHaveBeenCalledWith({
			sheetId: 200,
			action: "changeStatus",
			expectedStatus: "finalized",
			status: "draft",
			reason: "再現テスト",
		}),
	);
	const calls = vi.mocked(confirmAction).mock.calls;
	expect(calls[calls.length - 1]?.[0]).toMatchObject({
		details: expect.arrayContaining([
			expect.stringContaining("社員4"),
			expect.stringContaining("最終評価済み → 下書き"),
		]),
	});
});
it("confirms deletion and removes the deleted selection after success", async () => {
	const { controller, view } = setup();
	await choose(view);
	fireEvent.change(view.getByLabelText("操作"), { target: { value: "delete" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(view.getByRole("button", { name: "操作内容を確認" }));
	await waitFor(() =>
		expect(controller.execute).toHaveBeenCalledWith({
			sheetId: 200,
			action: "delete",
			expectedStatus: "finalized",
			status: undefined,
			reason: "再現テスト",
		}),
	);
	await waitFor(() =>
		expect((view.getByLabelText("対象シート") as HTMLSelectElement).value).toBe(""),
	);
});
it("shows an authorization error when the server refuses the list", async () => {
	const controller = { periods: vi.fn().mockRejectedValue(new Error("Admin のみ操作できます")) };
	const view = render(() => (
		<PrivilegedOperationsView
			controller={controller as unknown as PrivilegedOperationsController}
		/>
	));
	expect(await view.findByText("Admin のみ操作できます")).toBeTruthy();
});
