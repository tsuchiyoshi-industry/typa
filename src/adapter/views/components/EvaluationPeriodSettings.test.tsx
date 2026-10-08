// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { confirmAction, showToast } from "../feedback";
import EvaluationPeriodSettings from "./EvaluationPeriodSettings";

vi.mock("../feedback", () => ({
	confirmAction: vi.fn().mockResolvedValue(true),
	showToast: vi.fn(),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const current = {
	id: 2,
	periodName: "今期",
	startDate: "2026-04-01",
	endDate: "2027-03-31",
	isActive: true,
};
const next = {
	id: 3,
	periodName: "来期",
	startDate: "2027-04-01",
	endDate: "2028-03-31",
	isActive: false,
};
function setup() {
	const controller = {
		load: vi.fn().mockResolvedValue([next, current]),
		save: vi.fn().mockResolvedValue({ success: true, message: "保存しました" }),
		remove: vi.fn().mockResolvedValue({ success: true, message: "削除しました" }),
		close: vi
			.fn()
			.mockImplementation(async (_id: number, confirmed: boolean) =>
				confirmed
					? { status: "closed", message: "「今期」を締め、「来期」を開始しました。" }
					: { status: "ready", closing: current, next, finalizedSheets: 12 },
			),
	};
	const view = render(() => <EvaluationPeriodSettings controller={controller} />);
	return { controller, view };
}

it("closes the period in progress only after a confirmation that lists what to check", async () => {
	const { controller, view } = setup();
	// 実施中の期間は、開始も削除もできない
	await view.findByText("実施中");
	expect(view.queryByRole("button", { name: "今期を開始する" })).toBeNull();
	expect(view.queryByRole("button", { name: "今期を削除" })).toBeNull();

	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(view.getByRole("button", { name: "来期を開始する" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
	const request = vi.mocked(confirmAction).mock.calls[0][0];
	expect(request).toMatchObject({
		title: "「今期」を締めて、「来期」を開始しますか？",
		tone: "danger",
	});
	const notes = request.details?.join("\n") ?? "";
	for (const note of [
		"12 件",
		"誰も変更できません",
		"作成漏れ",
		"等級",
		"評価者",
		"元に戻せます",
	]) {
		expect(notes).toContain(note);
	}
	// 確認でやめたら、何も切り替えない
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(2));
	expect(controller.close).toHaveBeenCalledExactlyOnceWith(3, false);

	fireEvent.click(view.getByRole("button", { name: "来期を開始する" }));
	await waitFor(() => expect(controller.close).toHaveBeenLastCalledWith(3, true));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith("success", "「今期」を締め、「来期」を開始しました。"),
	);
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(3));
});

it("does not ask for confirmation while unfinalized sheets remain", async () => {
	const { controller, view } = setup();
	controller.close.mockResolvedValue({
		status: "rejected",
		message: "「今期」に未確定の評価シートが 3 件あります。",
	});
	fireEvent.click(await view.findByRole("button", { name: "来期を開始する" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"評価期間を切り替えられません",
			"「今期」に未確定の評価シートが 3 件あります。",
		),
	);
	expect(confirmAction).not.toHaveBeenCalled();
	expect(controller.close).toHaveBeenCalledExactlyOnceWith(3, false);
});

it("adds, edits and deletes periods", async () => {
	const { controller, view } = setup();
	await view.findByText("実施中");
	const field = (name: string) => view.getByLabelText(name) as HTMLInputElement;
	fireEvent.input(field("期間名"), { target: { value: "次期" } });
	fireEvent.input(field("開始日"), { target: { value: "2028-04-01" } });
	fireEvent.input(field("終了日"), { target: { value: "2029-03-31" } });
	fireEvent.click(view.getByRole("button", { name: "追加する" }));
	await waitFor(() =>
		expect(controller.save).toHaveBeenCalledWith({
			periodName: "次期",
			startDate: "2028-04-01",
			endDate: "2029-03-31",
		}),
	);
	await waitFor(() => expect(field("期間名").value).toBe(""));

	// 保存のあと一覧を取り直す間は、ボタンが止まっている
	await waitFor(() =>
		expect((view.getByRole("button", { name: "来期を編集" }) as HTMLButtonElement).disabled).toBe(
			false,
		),
	);
	fireEvent.click(view.getByRole("button", { name: "来期を編集" }));
	expect(field("開始日").value).toBe("2027-04-01");
	fireEvent.input(field("期間名"), { target: { value: "来期(改)" } });
	fireEvent.click(view.getByRole("button", { name: "変更を保存する" }));
	await waitFor(() =>
		expect(controller.save).toHaveBeenLastCalledWith({
			periodId: 3,
			periodName: "来期(改)",
			startDate: "2027-04-01",
			endDate: "2028-03-31",
		}),
	);

	await waitFor(() =>
		expect((view.getByRole("button", { name: "来期を削除" }) as HTMLButtonElement).disabled).toBe(
			false,
		),
	);
	fireEvent.click(view.getByRole("button", { name: "来期を削除" }));
	await waitFor(() => expect(controller.remove).toHaveBeenCalledWith(3));
	expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger" }));
});
