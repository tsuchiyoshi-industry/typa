// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { EvaluationPeriodController } from "../../controllers/EvaluationPeriodController";
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

const previous = {
	id: 1,
	periodName: "前期",
	termName: "前期",
	startDate: "2025-04-01",
	endDate: "2026-03-31",
	isActive: false,
	state: "closed" as const,
	stateLabel: "締め済み",
	allowUnfinalizedClose: false,
};
const current = {
	id: 2,
	periodName: "今期",
	termName: "今期",
	startDate: "2026-04-01",
	endDate: "2027-03-31",
	isActive: true,
	state: "active" as const,
	stateLabel: "実施中",
	allowUnfinalizedClose: false,
};
const next = {
	id: 3,
	periodName: "来期",
	termName: "来期",
	startDate: "2027-04-01",
	endDate: "2028-03-31",
	isActive: false,
	state: "not_started" as const,
	stateLabel: "未開始",
	allowUnfinalizedClose: true,
};
/** 今期を締めた後の来期(準備中)と、締めた今期。 */
const preparingNext = { ...next, state: "preparing" as const, stateLabel: "準備中" };
const closedCurrent = {
	...current,
	isActive: false,
	state: "closed" as const,
	stateLabel: "締め済み",
};
// 分け方の計算(プレビュー)は、保存を伴わないので本物を使う
const real = new EvaluationPeriodController(
	...([{}, {}, {}, {}] as unknown as ConstructorParameters<typeof EvaluationPeriodController>),
);
function controllerMock() {
	return {
		preview: (request: Parameters<EvaluationPeriodController["preview"]>[0]) =>
			real.preview(request),
		divisions: real.divisions,
		load: vi.fn().mockResolvedValue([next, current, previous]),
		save: vi.fn().mockResolvedValue({ success: true, message: "保存しました" }),
		remove: vi.fn().mockResolvedValue({ success: true, message: "削除しました" }),
		close: vi.fn().mockImplementation(async (_id: number, confirmed: boolean) =>
			confirmed
				? {
						status: "closed",
						message:
							"「今期」を締めました。「来期」は準備中です。等級の変更などを済ませてから開始してください。",
					}
				: {
						status: "ready",
						closing: current,
						preparing: preparingNext,
						finalizedSheets: 12,
						unfinishedSheets: 0,
					},
		),
		start: vi
			.fn()
			.mockImplementation(async (_id: number, confirmed: boolean) =>
				confirmed
					? { status: "started", message: "「来期」を開始しました。" }
					: { status: "ready", next: preparingNext },
			),
	};
}
/** prepare で、描く前にコントローラの返す値を変えられる(最初の読み込みを失敗させるなど)。 */
function setup(prepare?: (controller: ReturnType<typeof controllerMock>) => void) {
	const controller = controllerMock();
	prepare?.(controller);
	const view = render(() => <EvaluationPeriodSettings controller={controller} />);
	return { controller, view };
}
const rowOf = (view: ReturnType<typeof render>, name: string) =>
	view.getByText(name, { selector: "td" }).closest("tr") as HTMLTableRowElement;

it("closes the period in progress only after a confirmation that lists what to check", async () => {
	const { controller, view } = setup();
	// 実施中の期間は、開始も削除もできない
	await view.findByText("実施中");
	expect(view.queryByRole("button", { name: "今期を開始する" })).toBeNull();
	expect(view.queryByRole("button", { name: "今期を削除" })).toBeNull();

	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(view.getByRole("button", { name: "今期を締める" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
	const request = vi.mocked(confirmAction).mock.calls[0][0];
	expect(request).toMatchObject({
		title: "「今期」を締めますか？",
		confirmLabel: "締める",
		tone: "danger",
	});
	const notes = request.details?.join("\n") ?? "";
	for (const note of [
		"12 件",
		"誰も変更できません",
		"作成漏れ",
		"自動では始まりません",
		"「来期」は準備中",
		"もう一度開始することはできません",
	]) {
		expect(notes).toContain(note);
	}
	// 確認でやめたら、何も締めない
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(2));
	expect(controller.close).toHaveBeenCalledExactlyOnceWith(2, false);

	fireEvent.click(view.getByRole("button", { name: "今期を締める" }));
	await waitFor(() => expect(controller.close).toHaveBeenLastCalledWith(2, true));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"success",
			"「今期」を締めました。「来期」は準備中です。等級の変更などを済ませてから開始してください。",
		),
	);
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(3));
	// 締めても、次の期間は開始しない
	expect(controller.start).not.toHaveBeenCalled();
});

it("offers only what can be done now: closing the period in progress, and nothing to start yet", async () => {
	const { view } = setup();
	await view.findByText("実施中");
	expect(rowOf(view, "前期").textContent).toContain("締め済み");
	expect(rowOf(view, "来期").textContent).toContain("未開始");
	// 実施中の期間があるうちは、どの期間も開始できない(先に締める)
	expect(view.queryAllByRole("button", { name: /を開始する$/ })).toHaveLength(0);
	expect(
		view.getAllByRole("button", { name: /を締める$/ }).map((b) => b.getAttribute("aria-label")),
	).toEqual(["今期を締める"]);
});

it("offers to start the period that is preparing, while nothing is in progress", async () => {
	const { view } = setup((controller) =>
		controller.load.mockResolvedValue([preparingNext, closedCurrent, previous]),
	);
	await view.findByText("準備中");
	expect(rowOf(view, "来期").textContent).toContain("準備中");
	expect(
		view.getAllByRole("button", { name: /を開始する$/ }).map((b) => b.getAttribute("aria-label")),
	).toEqual(["来期を開始する"]);
	expect(view.queryAllByRole("button", { name: /を締める$/ })).toHaveLength(0);
});

it("starts the preparing period after a confirmation about grades and new sheets", async () => {
	const { controller, view } = setup((mock) =>
		mock.load.mockResolvedValue([preparingNext, closedCurrent, previous]),
	);
	fireEvent.click(await view.findByRole("button", { name: "来期を開始する" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
	const request = vi.mocked(confirmAction).mock.calls[0][0];
	expect(request).toMatchObject({
		title: "「来期」を開始しますか？",
		confirmLabel: "この期間を開始する",
	});
	const notes = request.details?.join("\n") ?? "";
	for (const note of ["新規作成", "等級", "評価者"]) {
		expect(notes).toContain(note);
	}
	await waitFor(() => expect(controller.start).toHaveBeenLastCalledWith(3, true));
	expect(controller.start.mock.calls).toEqual([
		[3, false],
		[3, true],
	]);
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith("success", "「来期」を開始しました。"),
	);
	expect(controller.close).not.toHaveBeenCalled();
});

it("explains a failed load and offers no operation until it loads again", async () => {
	const { controller, view } = setup((mock) =>
		mock.load.mockRejectedValueOnce(new Error('column "closed_at" does not exist')),
	);
	const alert = await view.findByRole("alert");
	expect(alert.textContent).toContain(
		'評価期間を読み込めませんでした。(column "closed_at" does not exist)',
	);
	expect(
		view.queryAllByRole("button", { name: /を開始する$|を締める$|を編集$|を削除$/ }),
	).toHaveLength(0);
	fireEvent.click(view.getByRole("button", { name: "再読み込み" }));
	await view.findByText("実施中");
	expect(view.queryByRole("alert")).toBeNull();
	expect(controller.load).toHaveBeenCalledTimes(2);
});

it("tells the Admin when the database refuses to close after confirmation", async () => {
	const { controller, view } = setup((mock) =>
		mock.close.mockImplementation(async (_id: number, confirmed: boolean) =>
			confirmed
				? {
						status: "rejected",
						message: "この評価期間は実施中ではないため、締められません。画面を開き直してください。",
					}
				: {
						status: "ready",
						closing: current,
						preparing: preparingNext,
						finalizedSheets: 1,
						unfinishedSheets: 0,
					},
		),
	);
	fireEvent.click(await view.findByRole("button", { name: "今期を締める" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"評価期間を締められませんでした",
			"この評価期間は実施中ではないため、締められません。画面を開き直してください。",
		),
	);
	// 一覧は読み直して、DB の状態を出す
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(2));
});

it("closes nothing twice when the button is pressed repeatedly", async () => {
	const { controller, view } = setup();
	const close = await view.findByRole("button", { name: "今期を締める" });
	fireEvent.click(close);
	fireEvent.click(close);
	fireEvent.click(close);
	await waitFor(() => expect(controller.close).toHaveBeenCalledWith(2, true));
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(2));
	expect(controller.close.mock.calls).toEqual([
		[2, false],
		[2, true],
	]);
});

it("keeps what was typed when saving fails", async () => {
	const { controller, view } = setup((mock) =>
		mock.save.mockResolvedValue({
			success: false,
			message: "「次期」という評価期間は既にあります。",
		}),
	);
	await view.findByText("実施中");
	const field = (name: string) => view.getByLabelText(name) as HTMLInputElement;
	fireEvent.input(field("期の名前"), { target: { value: "次期" } });
	fireEvent.input(field("開始日"), { target: { value: "2028-04-01" } });
	fireEvent.input(field("終了日"), { target: { value: "2029-03-31" } });
	fireEvent.click(view.getByRole("button", { name: "追加する" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith("error", "「次期」という評価期間は既にあります。"),
	);
	expect(controller.save).toHaveBeenCalledOnce();
	expect([field("期の名前").value, field("開始日").value]).toEqual(["次期", "2028-04-01"]);
});

it("does not ask for confirmation while unfinalized sheets remain", async () => {
	const { controller, view } = setup();
	controller.close.mockResolvedValue({
		status: "rejected",
		message: "「今期」に未確定の評価シートが 3 件あります。",
	});
	fireEvent.click(await view.findByRole("button", { name: "今期を締める" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"評価期間を締められません",
			"「今期」に未確定の評価シートが 3 件あります。",
		),
	);
	expect(confirmAction).not.toHaveBeenCalled();
	expect(controller.close).toHaveBeenCalledExactlyOnceWith(2, false);
});

it("tells the Admin when starting is refused, and starts nothing", async () => {
	const { controller, view } = setup((mock) => {
		mock.load.mockResolvedValue([preparingNext, closedCurrent, previous]);
		mock.start.mockImplementation(async (_id: number, confirmed: boolean) =>
			confirmed
				? { status: "rejected", message: "次に開始できるのは、準備中の評価期間だけです。" }
				: { status: "ready", next: preparingNext },
		);
	});
	fireEvent.click(await view.findByRole("button", { name: "来期を開始する" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"評価期間を開始できませんでした",
			"次に開始できるのは、準備中の評価期間だけです。",
		),
	);
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(2));
});

it("explains why a term cannot be divided instead of listing periods", async () => {
	const { controller, view } = setup();
	await view.findByText("実施中");
	const field = (name: string) => view.getByLabelText(name) as HTMLInputElement;
	fireEvent.input(field("期の名前"), { target: { value: "短期" } });
	fireEvent.input(field("開始日"), { target: { value: "2028-04-01" } });
	fireEvent.input(field("終了日"), { target: { value: "2028-06-30" } });
	// 通年なら1つの評価期間。四半期なら3か月ずつ必要
	expect(view.getByRole("list", { name: "追加される評価期間" }).textContent).toBe(
		"短期2028-04-01 〜 2028-06-30",
	);
	fireEvent.click(view.getByLabelText("四半期"));
	expect(view.queryByRole("list", { name: "追加される評価期間" })).toBeNull();
	expect(view.getByRole("alert").textContent).toBe(
		"四半期に分けるには期間が短すぎます。開始日と終了日を確かめてください。",
	);
	expect(controller.save).not.toHaveBeenCalled();
});

it("adds, edits and deletes periods", async () => {
	const { controller, view } = setup();
	await view.findByText("実施中");
	const field = (name: string) => view.getByLabelText(name) as HTMLInputElement;
	fireEvent.input(field("期の名前"), { target: { value: "次期" } });
	fireEvent.input(field("開始日"), { target: { value: "2028-04-01" } });
	fireEvent.input(field("終了日"), { target: { value: "2029-03-31" } });
	// 上期・下期に分けると、追加される期間を先に見せる
	fireEvent.click(view.getByLabelText("半期(上期・下期)"));
	expect(view.getByRole("list", { name: "追加される評価期間" }).textContent).toBe(
		"次期 上期2028-04-01 〜 2028-09-30次期 下期2028-10-01 〜 2029-03-31",
	);
	fireEvent.click(view.getByRole("button", { name: "追加する" }));
	await waitFor(() =>
		expect(controller.save).toHaveBeenCalledWith({
			termName: "次期",
			startDate: "2028-04-01",
			endDate: "2029-03-31",
			division: "half",
			allowUnfinalizedClose: false,
		}),
	);
	await waitFor(() => expect(field("期の名前").value).toBe(""));

	// 保存のあと一覧を取り直す間は、ボタンが止まっている
	await waitFor(() =>
		expect((view.getByRole("button", { name: "来期を編集" }) as HTMLButtonElement).disabled).toBe(
			false,
		),
	);
	fireEvent.click(view.getByRole("button", { name: "来期を編集" }));
	expect(field("開始日").value).toBe("2027-04-01");
	fireEvent.input(field("期の名前"), { target: { value: "来期(改)" } });
	fireEvent.click(view.getByRole("button", { name: "変更を保存する" }));
	await waitFor(() =>
		expect(controller.save).toHaveBeenLastCalledWith({
			periodId: 3,
			termName: "来期(改)",
			startDate: "2027-04-01",
			endDate: "2028-03-31",
			allowUnfinalizedClose: true,
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
