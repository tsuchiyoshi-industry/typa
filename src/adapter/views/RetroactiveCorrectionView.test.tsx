// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { CorrectableSheetDto } from "../../application/dtos/SheetCorrectionDto";
import type { RetroactiveCorrectionController } from "../controllers/RetroactiveCorrectionController";
import SheetCorrectionsNotice from "./components/SheetCorrectionsNotice";
import { confirmAction, showToast } from "./feedback";
import RetroactiveCorrectionView from "./RetroactiveCorrectionView";

vi.mock("./feedback", () => {
	const confirmAction = vi.fn();
	return {
		confirmAction,
		// 書きかけがあるときだけ確かめる(本物と同じ)
		confirmDiscard: vi.fn(async (dirty: boolean) => !dirty || confirmAction()),
		showToast: vi.fn(),
		trackUnsaved: vi.fn(),
	};
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const CLOSED = {
	id: 1,
	periodName: "25期",
	state: "closed",
	stateLabel: "締め済み",
	isActive: false,
};
const ACTIVE = { id: 2, periodName: "26期", state: "active", stateLabel: "実施中", isActive: true };

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

function setup(
	options: { sheet?: CorrectableSheetDto; periodsFail?: boolean; periods?: (typeof CLOSED)[] } = {},
) {
	const controller = {
		periods: options.periodsFail
			? vi.fn().mockRejectedValue(new Error("Admin のみ操作できます。"))
			: vi.fn().mockResolvedValue(options.periods ?? [CLOSED]),
		sheets: vi.fn().mockResolvedValue([
			{
				sheetId: 100,
				employeeName: "社員4",
				employeeNo: "E4",
				status: "finalized",
				gradeId: 1,
				gradeName: "一般1級",
			},
			{
				sheetId: 101,
				employeeName: "社員5",
				employeeNo: "E5",
				status: "submitted",
				gradeId: 1,
				gradeName: "一般1級",
			},
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
		operate: vi.fn().mockResolvedValue({ success: true, message: "記録しました" }),
		grades: vi.fn().mockResolvedValue([
			{ id: 1, name: "一般1級" },
			{ id: 2, name: "主任" },
			{ id: 3, name: "係長" },
		]),
		changeGrade: vi.fn().mockResolvedValue({ success: true, message: "等級を変更しました" }),
	};
	const view = render(() => (
		<RetroactiveCorrectionView
			controller={controller as unknown as RetroactiveCorrectionController}
		/>
	));
	return { controller, view };
}
type View = ReturnType<typeof render>;
const pick = async (view: View, name = "社員4") =>
	fireEvent.click(await view.findByRole("button", { name: `${name}さんのシートを選ぶ` }));
const openSheet = async (view: View) => {
	await pick(view);
	await view.findByText(/社員4さん\(E4\)・25期/);
	await view.findByRole("group", { name: "チャレンジ目標 1" });
};
const mode = (view: View, name: string) => view.getByRole("tab", { name });
const field = (view: View, label: string) =>
	view.getAllByLabelText(label)[0] as HTMLTextAreaElement;
const reasonBox = (view: View) => view.getByLabelText(/理由/) as HTMLTextAreaElement;
const submitButton = (view: View) =>
	view.getByRole("button", { name: /を確認/ }) as HTMLButtonElement;

// ----- 値を直す(締め済みの期間だけ) -----

it("asks for a change and a reason before anything can be checked", async () => {
	const { view } = setup();
	await openSheet(view);
	expect(mode(view, "値を直す").getAttribute("aria-selected")).toBe("true");
	expect(submitButton(view).disabled).toBe(true);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	expect(field(view, "達成状況 1").closest(".correction-field--changed")).toBeTruthy();
	expect(submitButton(view).disabled).toBe(true);
	fireEvent.input(reasonBox(view), { target: { value: "   " } });
	expect(submitButton(view).disabled).toBe(true);
	fireEvent.input(reasonBox(view), { target: { value: "評価会議での訂正" } });
	expect(submitButton(view).disabled).toBe(false);
	expect(submitButton(view).textContent).toContain("1件");
	// 元の値に戻せば、直すものは無い
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "達成" } });
	expect(submitButton(view).disabled).toBe(true);
});

it("records nothing when the confirmation is declined, and records after it is accepted", async () => {
	const { controller, view } = setup();
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	fireEvent.input(reasonBox(view), { target: { value: "評価会議での訂正" } });

	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(submitButton(view));
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

	// 記録した後に読み直すと、直した値と修正の記録が付いて返る
	const corrected = loaded();
	corrected.goals[0] = {
		...corrected.goals[0],
		periodGoals: [{ description: "", achievement: "訂正" }],
	};
	corrected.corrections = [
		{
			id: 1,
			subject: "チャレンジ目標 1・期中目標と達成状況",
			before: "達成",
			after: "訂正",
			reason: "評価会議での訂正",
			correctedAt: "2026-10-28T01:00:00Z",
		},
	];
	controller.load.mockResolvedValueOnce(corrected);
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(submitButton(view));
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "1 件修正しました。"));
	expect(controller.correct).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true }));
	// 読み直した内容を出し、入力は空に戻る
	const record = await view.findByRole("region", { name: "このシートの修正の記録(1件)" });
	expect(record.textContent).toContain("理由: 評価会議での訂正");
	expect(field(view, "達成状況 1").value).toBe("訂正");
	expect(field(view, "達成状況 1").closest(".correction-field--changed")).toBeNull();
	expect(submitButton(view).disabled).toBe(true);
	expect(reasonBox(view).value).toBe("");
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
	fireEvent.input(reasonBox(view), { target: { value: "訂正の理由" } });
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"修正を記録できませんでした",
			"遡及処理で修正できるのは、締め済みの評価期間のシートだけです。",
		),
	);
	expect(field(view, "達成状況 1").value).toBe("訂正");
	expect(reasonBox(view).value).toBe("訂正の理由");
});

it("stops before confirming when the check finds a problem", async () => {
	const { controller, view } = setup();
	controller.correct.mockResolvedValue({
		status: "rejected",
		message: "今と同じ内容には修正できません。",
	} as never);
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	fireEvent.input(reasonBox(view), { target: { value: "理由" } });
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"修正できません",
			"今と同じ内容には修正できません。",
		),
	);
	expect(confirmAction).not.toHaveBeenCalled();
});

it("offers no second score on a sheet without a secondary evaluator", async () => {
	const { view } = setup({ sheet: loaded(true) });
	await openSheet(view);
	expect(view.getAllByLabelText("一次評価")).toHaveLength(2);
	expect(view.queryAllByLabelText("二次評価")).toHaveLength(0);
	expect(view.queryByLabelText("二次評価者の総評")).toBeNull();
});

it("moves the theme's achievement into a first added task as two recorded changes", async () => {
	const sheet = loaded();
	sheet.goals[0] = { ...sheet.goals[0], achievement: "テーマの実績", periodGoals: [] };
	const { controller, view } = setup({ sheet });
	await openSheet(view);
	fireEvent.click(view.getByRole("button", { name: "期中目標を追加" }));
	expect(view.queryByLabelText("達成状況")).toBeNull();
	expect(field(view, "達成状況 1").value).toBe("テーマの実績");
	fireEvent.input(reasonBox(view), { target: { value: "評価会議での訂正" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(submitButton(view));
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

// ----- 状態を変える・削除する(どの期間でも) -----

it("offers only status changes and deletion on a sheet of a period that is not closed", async () => {
	const { controller, view } = setup({ periods: [ACTIVE, CLOSED] });
	await pick(view);
	await view.findByText(/社員4さん\(E4\)・26期/);
	expect((mode(view, "値を直す") as HTMLButtonElement).disabled).toBe(true);
	expect(mode(view, "状態を変える").getAttribute("aria-selected")).toBe("true");
	expect(view.getByText(/値を直せるのは、締め済みの評価期間のシートだけです/)).toBeTruthy();
	// 締めていない期間の中身は読みにいかない(DB も断る)
	expect(controller.load).not.toHaveBeenCalled();
});

it("confirms the exact status change, writing nothing until it is accepted", async () => {
	const { controller, view } = setup({ periods: [ACTIVE, CLOSED] });
	await pick(view);
	await view.findByText(/社員4さん\(E4\)・26期/);
	// 今の状態は選べない
	expect((view.getByRole("radio", { name: /評価確定/ }) as HTMLInputElement).disabled).toBe(true);
	fireEvent.click(view.getByRole("radio", { name: /下書き/ }));
	expect(submitButton(view).disabled).toBe(true);
	fireEvent.input(reasonBox(view), { target: { value: "再現テスト" } });
	expect(submitButton(view).textContent).toBe("状態の変更を確認");

	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(submitButton(view));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(controller.operate).not.toHaveBeenCalled();
	await waitFor(() => expect(submitButton(view).disabled).toBe(false));
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		message: "理由: 再現テスト",
		details: ["社員4(E4)・26期", "評価確定 → 下書き"],
		tone: "danger",
	});

	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(controller.operate).toHaveBeenCalledWith({
			sheetId: 100,
			action: "changeStatus",
			expectedStatus: "finalized",
			status: "draft",
			reason: "再現テスト",
		}),
	);
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "記録しました"));
	// 一覧を読み直して、新しい状態で続けて操作できる
	await waitFor(() => expect(controller.sheets).toHaveBeenCalledTimes(2));
	expect(reasonBox(view).value).toBe("");
});

it("can change the status of a closed sheet too, without losing the values tab", async () => {
	const { controller, view } = setup();
	await openSheet(view);
	fireEvent.click(mode(view, "状態を変える"));
	fireEvent.click(view.getByRole("radio", { name: /一次評価待ち/ }));
	fireEvent.input(reasonBox(view), { target: { value: "差し戻し" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(controller.operate).toHaveBeenCalledWith(
			expect.objectContaining({ action: "changeStatus", status: "submitted" }),
		),
	);
});

it("confirms deletion and leaves no sheet selected afterwards", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	await pick(view);
	fireEvent.click(await view.findByRole("tab", { name: "削除する" }));
	expect(view.getByText(/目標・評価・修正の記録もまとめて削除/)).toBeTruthy();
	fireEvent.input(reasonBox(view), { target: { value: "テストデータ" } });
	expect(submitButton(view).textContent).toBe("削除を確認");
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(controller.operate).toHaveBeenCalledWith({
			sheetId: 100,
			action: "delete",
			expectedStatus: "finalized",
			status: undefined,
			reason: "テストデータ",
		}),
	);
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		title: "シートを削除しますか？",
		confirmLabel: "シートを削除する",
	});
	await view.findByText("左の一覧から、シートを選んでください。");
});

it("keeps the selection and the reason when the server refuses the operation", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	controller.operate.mockResolvedValue({ success: false, message: "シートの状態が変わりました" });
	vi.mocked(confirmAction).mockResolvedValue(true);
	await pick(view);
	fireEvent.click(await view.findByRole("tab", { name: "削除する" }));
	fireEvent.input(reasonBox(view), { target: { value: "テストデータ" } });
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"操作を実行できませんでした",
			"シートの状態が変わりました",
		),
	);
	expect(reasonBox(view).value).toBe("テストデータ");
	expect(view.getByText(/社員4さん\(E4\)・26期/)).toBeTruthy();
});

it("asks before dropping value edits to switch to another operation", async () => {
	const { view } = setup();
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(mode(view, "削除する"));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(mode(view, "値を直す").getAttribute("aria-selected")).toBe("true");
	expect(field(view, "達成状況 1").value).toBe("訂正");
});

// ----- 一覧 -----

it("explains why nothing can be shown to someone who may not operate", async () => {
	const { view } = setup({ periodsFail: true });
	await view.findByText("Admin のみ操作できます。");
	expect(view.queryByRole("button", { name: /を選ぶ/ })).toBeNull();
});

it("labels each period with its state and starts from the active one", async () => {
	const { controller, view } = setup({ periods: [ACTIVE, CLOSED] });
	const select = (await view.findByLabelText("評価期間")) as HTMLSelectElement;
	expect([...select.options].map((option) => option.textContent)).toEqual([
		"26期(実施中)",
		"25期(締め済み)",
	]);
	await waitFor(() => expect(controller.sheets).toHaveBeenCalledWith(2));
});

it("shows the sheets of the period switched to, starting from a period with none", async () => {
	const { controller, view } = setup({ periods: [ACTIVE, CLOSED] });
	controller.sheets.mockImplementation(async (id: number) =>
		id === CLOSED.id
			? [{ sheetId: 100, employeeName: "社員4", employeeNo: "E4", status: "finalized" }]
			: [],
	);
	await view.findByText("この評価期間のシートはありません。");
	fireEvent.change(view.getByLabelText("評価期間"), { target: { value: String(CLOSED.id) } });
	expect(await view.findByRole("button", { name: "社員4さんのシートを選ぶ" })).toBeTruthy();
	expect((view.getByLabelText("評価期間") as HTMLSelectElement).value).toBe(String(CLOSED.id));
});

it("narrows the sheets by employee number or name, ignoring full-width input", async () => {
	const { view } = setup();
	await view.findByRole("button", { name: "社員5さんのシートを選ぶ" });
	fireEvent.input(view.getByRole("searchbox", { name: "社員番号・氏名で絞り込む" }), {
		target: { value: "ｅ４" },
	});
	expect(view.getByRole("button", { name: "社員4さんのシートを選ぶ" })).toBeTruthy();
	expect(view.queryByRole("button", { name: "社員5さんのシートを選ぶ" })).toBeNull();
	expect(view.getByRole("status").textContent).toBe("1 / 2 件");
	fireEvent.input(view.getByRole("searchbox"), { target: { value: "該当なし" } });
	expect(view.getByText("該当するシートはありません。")).toBeTruthy();
});

it("asks before dropping a half-written correction to open another sheet", async () => {
	const { controller, view } = setup();
	await openSheet(view);
	fireEvent.input(field(view, "達成状況 1"), { target: { value: "訂正" } });
	const other = view.getByRole("button", { name: "社員5さんのシートを選ぶ" });

	// 「編集を続ける」なら、今のシートと入力が残る
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(other);
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(controller.load).toHaveBeenCalledTimes(1);
	expect(field(view, "達成状況 1").value).toBe("訂正");
	expect(
		view.getByRole("button", { name: "社員4さんのシートを選ぶ" }).getAttribute("aria-current"),
	).toBe("true");

	// 破棄すれば、別のシートを開く
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(other);
	await waitFor(() => expect(controller.load).toHaveBeenLastCalledWith(101));
});

it("opens another sheet without asking when nothing was changed", async () => {
	const { controller, view } = setup();
	await openSheet(view);
	fireEvent.click(view.getByRole("button", { name: "社員5さんのシートを選ぶ" }));
	await waitFor(() => expect(controller.load).toHaveBeenLastCalledWith(101));
	expect(confirmAction).not.toHaveBeenCalled();
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

// ----- 等級を変える(当期・一次評価の確定前だけ) -----

const openGrade = async (view: View, name = "社員5") => {
	await pick(view, name);
	fireEvent.click(await view.findByRole("tab", { name: "等級を変える" }));
	return (await view.findByLabelText("変更後の等級")) as HTMLSelectElement;
};

it("warns that common evaluation input is deleted for good, and nothing else", async () => {
	const { view } = setup({ periods: [ACTIVE] });
	await openGrade(view);
	const pane = view.getByRole("tabpanel");
	expect(pane.textContent).toContain("今の等級一般1級");
	expect(pane.textContent).toContain("共通評価で入力済みの点数とコメントは、すべて削除されます");
	expect(pane.textContent).toContain(
		"チャレンジ目標・期中目標・達成状況・点数・総評は変わりません",
	);
	expect(pane.textContent).toContain("この操作は取り消せません");
});

it("offers every grade except the current one", async () => {
	const { view } = setup({ periods: [ACTIVE] });
	const select = await openGrade(view);
	await waitFor(() => expect(select.options.length).toBe(3));
	expect([...select.options].map((option) => option.textContent)).toEqual([
		"選んでください",
		"主任",
		"係長",
	]);
});

it("offers every grade when the sheet had no grade", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	controller.sheets.mockResolvedValue([
		{
			sheetId: 101,
			employeeName: "社員5",
			employeeNo: "E5",
			status: "draft",
			gradeId: null,
			gradeName: "",
		},
	]);
	const select = await openGrade(view);
	await waitFor(() => expect(select.options.length).toBe(4));
	expect(view.getByRole("tabpanel").textContent).toContain("今の等級未設定");
});

it("asks only once for the grade list, and only when the grade tab is opened", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	await pick(view, "社員5");
	await view.findByText(/社員5さん\(E5\)・26期/);
	expect(controller.grades).not.toHaveBeenCalled();
	await openGrade(view);
	fireEvent.click(mode(view, "状態を変える"));
	fireEvent.click(mode(view, "等級を変える"));
	await view.findByLabelText("変更後の等級");
	expect(controller.grades).toHaveBeenCalledOnce();
});

it("needs a grade and a reason, and writes nothing until the confirmation is accepted", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	const select = await openGrade(view);
	await waitFor(() => expect(select.options.length).toBe(3));
	expect(submitButton(view).disabled).toBe(true);
	fireEvent.change(select, { target: { value: "2" } });
	expect(submitButton(view).disabled).toBe(true);
	fireEvent.input(reasonBox(view), { target: { value: "等級の登録誤り" } });
	expect(submitButton(view).textContent).toBe("等級の変更を確認");
	expect(submitButton(view).classList.contains("danger")).toBe(true);

	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(submitButton(view));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(controller.changeGrade).not.toHaveBeenCalled();
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		title: "シートの等級を変更しますか？",
		message: "理由: 等級の登録誤り",
		details: ["社員5(E5)・26期", "一般1級 → 主任", "共通評価の入力(点数・コメント)をすべて削除"],
		note: expect.stringContaining("この操作は取り消せません"),
		confirmLabel: "等級を変更する",
		tone: "danger",
	});

	await waitFor(() => expect(submitButton(view).disabled).toBe(false));
	vi.mocked(confirmAction).mockResolvedValueOnce(true);
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(controller.changeGrade).toHaveBeenCalledWith({
			sheetId: 101,
			gradeId: 2,
			expectedGradeId: 1,
			expectedStatus: "submitted",
			reason: "等級の登録誤り",
		}),
	);
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "等級を変更しました"));
	// 一覧を読み直して新しい等級で続けられる。入力は空に戻る
	await waitFor(() => expect(controller.sheets).toHaveBeenCalledTimes(2));
	expect(reasonBox(view).value).toBe("");
	expect(controller.operate).not.toHaveBeenCalled();
});

it("keeps the chosen grade and the reason when the server refuses", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	controller.changeGrade.mockResolvedValue({
		success: false,
		message: "シートの状態か等級が変わりました。再読み込みしてから操作してください。",
	});
	vi.mocked(confirmAction).mockResolvedValue(true);
	const select = await openGrade(view);
	await waitFor(() => expect(select.options.length).toBe(3));
	fireEvent.change(select, { target: { value: "3" } });
	fireEvent.input(reasonBox(view), { target: { value: "等級の登録誤り" } });
	fireEvent.click(submitButton(view));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"等級を変更できませんでした",
			"シートの状態か等級が変わりました。再読み込みしてから操作してください。",
		),
	);
	expect(select.value).toBe("3");
	expect(reasonBox(view).value).toBe("等級の登録誤り");
});

it("cannot submit when the grade list fails to load, and says why", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	controller.grades.mockRejectedValue(new Error("offline"));
	await pick(view, "社員5");
	fireEvent.click(await view.findByRole("tab", { name: "等級を変える" }));
	await view.findByText(/等級の一覧を読み込めませんでした/);
	fireEvent.input(reasonBox(view), { target: { value: "理由" } });
	expect(submitButton(view).disabled).toBe(true);
});

it.each([
	[
		"a closed period",
		[CLOSED],
		"社員5",
		"等級を変えられるのは、当期(実施中の評価期間)のシートだけです。",
	],
	[
		"a confirmed first evaluation",
		[ACTIVE],
		"社員4",
		"一次評価が確定したシートの等級は、先に状態を一次評価待ちまでに戻すと変えられます。",
	],
] as const)("offers no grade change for %s, and says why", async (_, periods, name, reason) => {
	const { controller, view } = setup({ periods: [...periods] });
	await pick(view, name);
	const tab = (await view.findByRole("tab", { name: "等級を変える" })) as HTMLButtonElement;
	expect(tab.disabled).toBe(true);
	expect(view.getByText(reason)).toBeTruthy();
	expect(controller.grades).not.toHaveBeenCalled();
});

it("asks before dropping a chosen grade to open another sheet", async () => {
	const { controller, view } = setup({ periods: [ACTIVE] });
	const select = await openGrade(view);
	await waitFor(() => expect(select.options.length).toBe(3));
	fireEvent.change(select, { target: { value: "2" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(view.getByRole("button", { name: "社員4さんのシートを選ぶ" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(select.value).toBe("2");
	expect(controller.changeGrade).not.toHaveBeenCalled();
});
