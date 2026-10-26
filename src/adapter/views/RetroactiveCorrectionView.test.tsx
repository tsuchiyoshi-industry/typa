// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { CorrectableSheetDto } from "../../application/dtos/SheetCorrectionDto";
import type { RetroactiveCorrectionController } from "../controllers/RetroactiveCorrectionController";
import SheetCorrectionsNotice from "./components/SheetCorrectionsNotice";
import { confirmAction, showToast } from "./feedback";
import RetroactiveCorrectionView from "./RetroactiveCorrectionView";

vi.mock("./feedback", () => ({ confirmAction: vi.fn(), showToast: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const loaded = (primaryIsFinalEvaluator = false): CorrectableSheetDto => ({
	sheetId: 100,
	employeeName: "社員4",
	employeeNo: "E4",
	periodName: "25期",
	status: "finalized",
	primaryIsFinalEvaluator,
	goals: [
		{
			id: 11,
			goalNumber: 1,
			challengeGoal: "目標",
			achievement: "",
			periodGoals: [{ description: "", achievement: "達成" }],
			firstScore: 3,
			secondScore: 3,
		},
	],
	commonItems: [{ itemId: 31, title: "協調性", firstScore: 3, secondScore: 4, firstComment: "" }],
	firstOverallComment: "",
	secondOverallComment: "総評",
	corrections: [],
});

function setup(options: { sheet?: CorrectableSheetDto; periodsFail?: boolean } = {}) {
	const controller = {
		closedPeriods: options.periodsFail
			? vi.fn().mockRejectedValue(new Error("Admin のみ操作できます。"))
			: vi.fn().mockResolvedValue([{ id: 1, periodName: "25期" }]),
		sheets: vi
			.fn()
			.mockResolvedValue([
				{ sheetId: 100, employeeName: "社員4", employeeNo: "E4", status: "finalized" },
			]),
		load: vi.fn().mockResolvedValue(options.sheet ?? loaded()),
		correct: vi.fn(async (request: { confirmed: boolean }) =>
			request.confirmed
				? { status: "corrected", message: "1 件修正しました。" }
				: {
						status: "ready",
						changes: [{ subject: "チャレンジ目標 1・達成状況", before: "達成", after: "訂正" }],
					},
		),
	};
	const view = render(() => (
		<RetroactiveCorrectionView
			controller={controller as unknown as RetroactiveCorrectionController}
		/>
	));
	return { controller, view };
}
const openSheet = async (view: ReturnType<typeof render>) => {
	fireEvent.click(await view.findByRole("button", { name: "社員4さんのシートを直す" }));
	await view.findByText(/社員4さん\(E4\)・25期を直す/);
};
const field = (view: ReturnType<typeof render>, label: string) =>
	view.getAllByLabelText(label)[0] as HTMLTextAreaElement;
const confirmButton = (view: ReturnType<typeof render>) =>
	view.getByRole("button", { name: /修正内容を確認/ }) as HTMLButtonElement;

it("asks for a change and a reason before anything can be checked", async () => {
	const { view } = setup();
	await openSheet(view);
	expect(confirmButton(view).disabled).toBe(true);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	expect(
		field(view, "達成状況 1")
			.closest(".correction-field--changed")
			?.classList.contains("correction-field--changed"),
	).toBe(true);
	expect(confirmButton(view).disabled).toBe(true);
	fireEvent.input(view.getByLabelText(/修正の理由/), { target: { value: "   " } });
	expect(confirmButton(view).disabled).toBe(true);
	fireEvent.input(view.getByLabelText(/修正の理由/), { target: { value: "評価会議での訂正" } });
	expect(confirmButton(view).disabled).toBe(false);
	expect(confirmButton(view).textContent).toContain("1件");
	// 元の値に戻せば、直すものは無い
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "達成" } });
	expect(confirmButton(view).disabled).toBe(true);
});

it("records nothing when the confirmation is declined, and records after it is accepted", async () => {
	const { controller, view } = setup();
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	fireEvent.input(view.getByLabelText(/修正の理由/), { target: { value: "評価会議での訂正" } });

	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(confirmButton(view));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		message: "理由: 評価会議での訂正",
		details: ["チャレンジ目標 1・達成状況: 達成 → 訂正"],
		tone: "danger",
	});
	expect(controller.correct).toHaveBeenCalledExactlyOnceWith({
		sheetId: 100,
		changes: [
			{
				target: "goal",
				targetId: 11,
				field: "period_goals",
				value: JSON.stringify([{ description: "", achievement: "訂正" }]),
			},
		],
		reason: "評価会議での訂正",
		confirmed: false,
	});

	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(confirmButton(view));
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "1 件修正しました。"));
	expect(controller.correct).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true }));
	// 記録した後は読み直して、入力は空に戻る
	await waitFor(() => expect(controller.load).toHaveBeenCalledTimes(2));
	expect(confirmButton(view).disabled).toBe(true);
});

it("keeps what was typed when the correction is refused", async () => {
	const { controller, view } = setup();
	controller.correct.mockImplementation(async (request: { confirmed: boolean }) =>
		request.confirmed
			? ({
					status: "rejected",
					message: "遡及処理で修正できるのは、締め済みの評価期間のシートだけです。",
				} as never)
			: ({ status: "ready", changes: [] } as never),
	);
	vi.mocked(confirmAction).mockResolvedValue(true);
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	fireEvent.input(view.getByLabelText(/修正の理由/), { target: { value: "訂正の理由" } });
	fireEvent.click(confirmButton(view));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"修正を記録できませんでした",
			"遡及処理で修正できるのは、締め済みの評価期間のシートだけです。",
		),
	);
	expect(field(view, "達成状況 1").value).toBe("訂正");
	expect((view.getByLabelText(/修正の理由/) as HTMLTextAreaElement).value).toBe("訂正の理由");
});

it("stops before confirming when the check finds a problem", async () => {
	const { controller, view } = setup();
	controller.correct.mockResolvedValue({
		status: "rejected",
		message: "今と同じ内容には修正できません。",
	} as never);
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	fireEvent.input(view.getByLabelText(/修正の理由/), { target: { value: "理由" } });
	fireEvent.click(confirmButton(view));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"修正できません",
			"今と同じ内容には修正できません。",
		),
	);
	expect(confirmAction).not.toHaveBeenCalled();
});

it("explains why nothing can be shown to someone who may not correct", async () => {
	const { view } = setup({ periodsFail: true });
	await view.findByText("Admin のみ操作できます。");
	expect(view.queryByRole("button", { name: /直す/ })).toBeNull();
});

it("offers no second score on a sheet without a secondary evaluator", async () => {
	const { view } = setup({ sheet: loaded(true) });
	await openSheet(view);
	expect(view.getAllByLabelText("一次評価")).toHaveLength(2);
	expect(view.queryAllByLabelText("二次評価")).toHaveLength(0);
	expect(view.queryByLabelText("二次評価者の総評")).toBeNull();
});

it("shows nothing when a sheet has no corrections, and every correction in red when it has", () => {
	const empty = render(() => <SheetCorrectionsNotice corrections={[]} />);
	expect(empty.container.textContent).toBe("");
	cleanup();
	const view = render(() => (
		<SheetCorrectionsNotice
			corrections={[
				{
					id: 1,
					subject: "チャレンジ目標 1・二次評価",
					before: "4",
					after: "3",
					reason: "転記ミス",
					correctedAt: "2026-10-23T01:00:00Z",
				},
			]}
		/>
	));
	const notice = view.getByRole("region", { name: "締め後修正があります(1件)" });
	expect(notice.classList.contains("correction-notice")).toBe(true);
	expect(notice.textContent).toContain("チャレンジ目標 1・二次評価4 → 3");
	expect(notice.textContent).toContain("理由: 転記ミス");
});

it("moves the theme's achievement into a first added task as two recorded changes", async () => {
	const sheet = loaded();
	sheet.goals[0] = { ...sheet.goals[0], achievement: "テーマの実績", periodGoals: [] };
	const { controller, view } = setup({ sheet });
	await openSheet(view);
	fireEvent.click(view.getByRole("button", { name: "期中目標を追加" }));
	expect(view.queryByLabelText("達成状況")).toBeNull();
	expect(field(view, "達成状況 1").value).toBe("テーマの実績");
	fireEvent.input(view.getByLabelText(/修正の理由/), { target: { value: "評価会議での訂正" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(confirmButton(view));
	await waitFor(() => expect(controller.correct).toHaveBeenCalledOnce());
	expect(vi.mocked(controller.correct).mock.calls[0][0]).toMatchObject({
		changes: [
			{
				field: "period_goals",
				value: JSON.stringify([{ description: "", achievement: "テーマの実績" }]),
			},
			{ field: "achievement", value: "" },
		],
	});
});
