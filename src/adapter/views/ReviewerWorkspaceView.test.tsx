// @vitest-environment jsdom
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { reviewerEditorFixture } from "../../test/reviewerEditorFixture";
import { reviewerRow } from "../../test/reviewerFixture";
import type { ReviewerWorkspaceController } from "../controllers/ReviewerWorkspaceController";
import FeedbackHost from "./components/FeedbackHost";
import { clearUnsavedChanges, settleConfirm } from "./feedback";
import ReviewerWorkspaceView from "./ReviewerWorkspaceView";

// jsdom は <dialog> の showModal / close を実装していない
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
	this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
	this.removeAttribute("open");
};

afterEach(() => {
	cleanup();
	clearUnsavedChanges();
	settleConfirm(false);
});
const periods = [
	{
		id: 10,
		periodName: "2026年度 下期",
		startDate: "2026-10-01",
		endDate: "2027-03-31",
		isActive: true,
	},
	{
		id: 9,
		periodName: "2026年度 上期",
		startDate: "2026-04-01",
		endDate: "2026-09-30",
		isActive: false,
	},
];
function setup(people: ReviewerRowDto[], url = "/review") {
	const rows = people;
	const history = createMemoryHistory();
	history.set({ value: url, replace: true, scroll: false });
	const controller = {
		loadPeriods: vi.fn().mockResolvedValue(periods),
		load: vi.fn().mockImplementation(async () => structuredClone(rows)),
	};
	const editor = reviewerEditorFixture(() => rows);

	const view = render(() => (
		<MemoryRouter
			history={history}
			root={(props) => (
				<>
					{props.children}
					<FeedbackHost />
				</>
			)}
		>
			<Route
				path="/review"
				component={() => (
					<ReviewerWorkspaceView
						controller={controller as unknown as ReviewerWorkspaceController}
						editor={editor}
					/>
				)}
			/>
		</MemoryRouter>
	));

	return { ...view, controller, history };
}

const submittedToPrimary = { status: "submitted", isPrimary: true, firstRank: null } as const;

it("searches the caseload and filters by whose turn it is", async () => {
	const view = setup([
		reviewerRow(1),
		reviewerRow(2, submittedToPrimary),
		reviewerRow(3, { sheetId: null, status: "missing" }),
	]);
	await view.findByRole("button", { name: /社員1.*E001/ });
	fireEvent.input(view.getByRole("searchbox"), { target: { value: "Ｅ００２" } });
	expect(view.queryByRole("button", { name: /社員1.*E001/ })).toBeNull();
	expect(view.getByRole("button", { name: /社員2.*E002/ })).toBeTruthy();
	fireEvent.input(view.getByRole("searchbox"), { target: { value: "" } });
	fireEvent.click(view.getByRole("button", { name: "二次評価する1人" }));
	expect(view.getByRole("button", { name: /社員1.*E001/ })).toBeTruthy();
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "一次評価する1人" }));
	expect(view.getByRole("button", { name: /社員2.*E002/ })).toBeTruthy();
	expect(view.controller.load).toHaveBeenCalledTimes(1);
});
it("hides the stages the reviewer has no part in", async () => {
	const view = setup([reviewerRow(1, { ...submittedToPrimary, canViewSecond: false })]);
	await view.findByRole("button", { name: "一次評価する1人" });
	expect(view.queryByRole("button", { name: /二次評価する/ })).toBeNull();
});
it("opens a sheet from anywhere on its row, but not a draft", async () => {
	const view = setup([reviewerRow(1), reviewerRow(2, { status: "draft" })]);
	const draft = (await view.findByText("提出待ち")).closest("tr") as HTMLElement;
	fireEvent.click(within(draft).getByText("技術1級"));
	expect(view.history.get()).not.toContain("sheet=");
	expect((within(draft).getByRole("button", { name: /社員2/ }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	fireEvent.click(
		within(
			view.getByText("二次評価する", { selector: "td *" }).closest("tr") as HTMLElement,
		).getByText("技術1級"),
	);
	await waitFor(() => expect(view.history.get()).toContain("sheet=101"));
	expect(view.history.get()).toContain("mode=evaluate");
});
it("compares selected people by grade and shows score differences and judgment evidence", async () => {
	const view = setup([
		reviewerRow(1),
		reviewerRow(2),
		reviewerRow(3, { gradeId: 2, gradeName: "技術2級" }),
	]);
	fireEvent.click(await view.findByRole("checkbox", { name: "社員1を比較に選択" }));
	fireEvent.click(view.getByRole("checkbox", { name: "社員2を比較に選択" }));
	fireEvent.click(view.getByRole("button", { name: "選択して比較 2 / 6" }));
	await view.findByRole("rowheader", { name: "一次・二次の差" });
	expect(view.getAllByText("二次評価の根拠")).toHaveLength(2);
	expect(view.getAllByText("計画に沿って達成")).toHaveLength(2);
	expect(view.queryByRole("heading", { name: "技術2級" })).toBeNull();
	expect(view.history.get()).toContain("mode=compare");
});
it("uses primary evaluators as labels and retains the filter while evaluating and comparing", async () => {
	const view = setup([
		reviewerRow(1, { primaryEvaluatorId: 20, primaryEvaluator: "井上 部長" }),
		reviewerRow(2, { primaryEvaluatorId: 21, primaryEvaluator: "松本 課長" }),
		reviewerRow(3, { primaryEvaluatorId: 20, primaryEvaluator: "井上 部長" }),
	]);
	await view.findByRole("checkbox", { name: "社員1を比較に選択" });
	fireEvent.change(view.getByRole("combobox", { name: "一次評価者で絞り込み" }), {
		target: { value: "20" },
	});
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: /社員1.*E001/ }));
	const sidebar = await view.findByRole("complementary", { name: "受け持ち一覧" });
	expect(within(sidebar).queryByRole("button", { name: "社員2の評価を開く" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "横断比較" }));
	await view.findByRole("button", { name: /社員3.*E003/ });
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "一次評価者の絞り込みを解除" }));
	await view.findByRole("button", { name: /社員2.*E002/ });
});
it("sets a primary evaluator filter by clicking the label in a row", async () => {
	const view = setup([
		reviewerRow(1, { primaryEvaluatorId: 20, primaryEvaluator: "井上 部長" }),
		reviewerRow(2, { primaryEvaluatorId: 21, primaryEvaluator: "松本 課長" }),
	]);
	fireEvent.click(
		await view.findByRole("button", { name: "一次評価者 井上 部長の受け持ちで絞り込む" }),
	);
	expect(
		(view.getByRole("combobox", { name: "一次評価者で絞り込み" }) as HTMLSelectElement).value,
	).toBe("20");
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
});
it("allows selecting multiple people from the comparison overview before opening details", async () => {
	const view = setup([reviewerRow(1), reviewerRow(2)], "/review?mode=compare");
	fireEvent.click(await view.findByRole("checkbox", { name: "社員1を比較に選択" }));
	fireEvent.click(view.getByRole("checkbox", { name: "社員2を比較に選択" }));
	fireEvent.click(view.getByRole("button", { name: "選択して比較 2 / 6" }));
	await view.findByRole("rowheader", { name: "一次・二次の差" });
	fireEvent.click(view.getByRole("button", { name: "選択を解除" }));
	await view.findByRole("checkbox", { name: "社員1を比較に選択" });
	fireEvent.click(view.getByRole("checkbox", { name: "社員1を比較に選択" }));
	expect(view.getByRole("checkbox", { name: "社員2を比較に選択" })).toBeTruthy();
});
it("shows primary judgment as read-only evidence while editing secondary evaluation", async () => {
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101&mode=evaluate");
	const first = await view.findByRole("textbox", { name: "一次評価者の総評" });
	expect((first as HTMLTextAreaElement).value).toBe("一次評価の根拠");
	expect((first as HTMLTextAreaElement).readOnly).toBe(true);
	expect(
		(view.getByRole("textbox", { name: "二次評価者の総評" }) as HTMLTextAreaElement).readOnly,
	).toBe(false);
});
it("finalizes after confirmation and advances to the reviewer's next turn", async () => {
	const view = setup(
		[reviewerRow(1), reviewerRow(2, { status: "submitted" }), reviewerRow(3)],
		"/review?period=10&sheet=101&mode=evaluate",
	);
	const action = await view.findByRole("button", { name: "二次評価を確定する" });
	await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(action);
	// ランクは選ばせず、点数から決まった結果を確定前に見せる
	const dialog = await view.findByRole("dialog");
	expect(dialog.textContent).toContain("最終評価ランクは S（95 点 / 100 点）");
	fireEvent.click(within(dialog).getByRole("button", { name: "評価を確定する" }));
	await waitFor(() => expect(view.history.get()).toContain("sheet=103"));
	const sidebar = view.getByRole("complementary", { name: "受け持ち一覧" });
	expect(within(sidebar).getByRole("button", { name: "社員1の評価を開く" }).textContent).toContain(
		"評価確定",
	);
});
it("confirms the primary evaluation with a notice that the secondary evaluator is notified", async () => {
	const view = setup(
		[reviewerRow(1, submittedToPrimary)],
		"/review?period=10&sheet=101&mode=evaluate",
	);
	fireEvent.click(await view.findByRole("button", { name: "一次評価を確定する" }));
	const dialog = await view.findByRole("dialog");
	expect(dialog.textContent).toContain("一次評価ランクは B（70 点 / 100 点）");
	expect(dialog.textContent).toContain("二次評価者（徳永 優）に通知メールを送ります");
	fireEvent.click(within(dialog).getByRole("button", { name: "一次評価を確定する" }));
	const sidebar = view.getByRole("complementary", { name: "受け持ち一覧" });
	await waitFor(() =>
		expect(
			within(sidebar).getByRole("button", { name: "社員1の評価を開く" }).textContent,
		).toContain("二次評価する"),
	);
	// 確定後は一次評価を変更できない
	expect(
		(view.getByRole("textbox", { name: "一次評価者の総評" }) as HTMLTextAreaElement).readOnly,
	).toBe(true);
});
it("lets a secondary evaluator read but not evaluate before the primary evaluation is confirmed", async () => {
	const view = setup(
		[reviewerRow(1, { status: "submitted", firstRank: null })],
		"/review?period=10&sheet=101&mode=evaluate",
	);
	const second = await view.findByRole("textbox", { name: "二次評価者の総評" });
	expect((second as HTMLTextAreaElement).readOnly).toBe(true);
	expect(view.queryByRole("button", { name: /確定する/ })).toBeNull();
	expect(view.getByText(/一次評価を確定すると、二次評価を入力できるようになります/)).toBeTruthy();
});
it("blocks finalization of unsaved comments without losing the draft", async () => {
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101&mode=evaluate");
	const textarea = await view.findByRole("textbox", { name: "二次評価者の総評" });
	fireEvent.input(textarea, { target: { value: "書きかけの判断" } });
	fireEvent.click(view.getByRole("button", { name: "二次評価を確定する" }));
	expect(view.queryByRole("dialog")).toBeNull();
	expect((textarea as HTMLTextAreaElement).value).toBe("書きかけの判断");
});
it("preserves an editor draft when a refresh reloads the caseload", async () => {
	const view = setup([reviewerRow(1), reviewerRow(2)], "/review?period=10&sheet=101&mode=evaluate");
	const textarea = await view.findByRole("textbox", { name: "二次評価者の総評" });
	fireEvent.input(textarea, { target: { value: "残したい下書き" } });
	fireEvent.click(view.getByRole("button", { name: "受け持ちを再読み込み" }));
	expect(view.controller.load).toHaveBeenCalledTimes(1);
	expect(
		(view.getByRole("textbox", { name: "二次評価者の総評" }) as HTMLTextAreaElement).value,
	).toBe("残したい下書き");
});
it("discards a stale period response when the reviewer changes periods quickly", async () => {
	const view = setup([reviewerRow(1)]);
	const pending = new Map<number, (rows: ReviewerRowDto[]) => void>();
	view.controller.load.mockImplementation(
		(id: number) => new Promise((resolve) => pending.set(id, resolve)),
	);
	await waitFor(() => expect(pending.has(10)).toBe(true));
	fireEvent.change(view.getByRole("combobox", { name: "評価期間" }), { target: { value: "9" } });
	await waitFor(() => expect(pending.has(9)).toBe(true));
	pending.get(9)?.([reviewerRow(2)]);
	await view.findByRole("button", { name: /社員2.*E002/ });
	pending.get(10)?.([reviewerRow(1)]);
	await Promise.resolve();
	expect(view.queryByRole("button", { name: /社員1.*E001/ })).toBeNull();
	expect(view.getByRole("button", { name: /社員2.*E002/ })).toBeTruthy();
});
it("keeps the editor available when refresh fails", async () => {
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101&mode=evaluate");
	await view.findByRole("textbox", { name: "二次評価者の総評" });
	view.controller.load.mockRejectedValueOnce(new Error("接続できません"));
	fireEvent.click(view.getByRole("button", { name: "受け持ちを再読み込み" }));
	await view.findByRole("alert");
	expect(view.getByRole("textbox", { name: "二次評価者の総評" })).toBeTruthy();
});
