import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { reviewerEditorFixture } from "../../test/reviewerEditorFixture";
import { reviewerRow } from "../../test/reviewerFixture";
import type { ReviewerWorkspaceController } from "../controllers/ReviewerWorkspaceController";
import FeedbackHost from "./components/FeedbackHost";
import { clearUnsavedChanges, settleConfirm } from "./feedback";
import ReviewerWorkspaceView from "./ReviewerWorkspaceView";

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

	// 評価シートと比較の窓は body の直下に出るので、画面全体から探す
	return { ...view, ...within(document.body), controller, editor, history };
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
	fireEvent.click(view.getByRole("button", { name: "二次評価する1名" }));
	expect(view.getByRole("button", { name: /社員1.*E001/ })).toBeTruthy();
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "一次評価する1名" }));
	expect(view.getByRole("button", { name: /社員2.*E002/ })).toBeTruthy();
	expect(view.controller.load).toHaveBeenCalledTimes(1);
});
it("hides the stages the reviewer has no part in", async () => {
	const view = setup([reviewerRow(1, { ...submittedToPrimary, canViewSecond: false })]);
	await view.findByRole("button", { name: "一次評価する1名" });
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
	// 一覧からは、画面を切り替えずに窓で開く
	expect(view.history.get()).not.toContain("mode=");
});
it("floats the sheet over the list, keeps the list behind it, and closes back to the same list", async () => {
	const view = setup([
		reviewerRow(1, { primaryEvaluatorId: 20, primaryEvaluator: "井上 部長" }),
		reviewerRow(2, { primaryEvaluatorId: 21, primaryEvaluator: "松本 課長" }),
	]);
	fireEvent.change(await view.findByRole("combobox", { name: "一次評価者で絞り込み" }), {
		target: { value: "20" },
	});
	fireEvent.click(view.getByRole("button", { name: /社員1.*E001/ }));
	// 窓は画面の外側(body の直下)に出るので、画面全体から探す
	const sheetWindow = await screen.findByRole("dialog", { name: "社員1 さんの評価シート" });
	expect(
		await within(sheetWindow).findByRole("textbox", { name: "二次評価者の総評" }),
	).toBeTruthy();
	// 後ろの一覧はそのまま残り、開いている行が分かる
	expect(
		view.getByRole("checkbox", { name: "社員1を比較に選択" }).closest("tr")?.className,
	).toContain("current");

	// 入力の途中で閉じようとしたら、破棄してよいか確かめる
	fireEvent.input(within(sheetWindow).getByRole("textbox", { name: "二次評価者の総評" }), {
		target: { value: "書きかけ" },
	});
	fireEvent.keyDown(sheetWindow, { key: "Escape" });
	const confirm = await screen.findByRole("dialog", { name: "保存していない変更があります" });
	fireEvent.click(within(confirm).getByRole("button", { name: "編集を続ける" }));
	expect(screen.getByRole("dialog", { name: "社員1 さんの評価シート" })).toBeTruthy();
	fireEvent.click(within(sheetWindow).getByRole("button", { name: "閉じる" }));
	fireEvent.click(
		within(await screen.findByRole("dialog", { name: "保存していない変更があります" })).getByRole(
			"button",
			{ name: "変更を破棄する" },
		),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(view.history.get()).not.toContain("sheet=");
	// 絞り込みは開く前のまま
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
});
it("moves on to the next turn inside the window after confirming from the list", async () => {
	const view = setup([reviewerRow(1), reviewerRow(2)], "/review?period=10&sheet=101");
	const sheetWindow = await screen.findByRole("dialog", { name: "社員1 さんの評価シート" });
	fireEvent.click(await within(sheetWindow).findByRole("button", { name: "二次評価を確定する" }));
	fireEvent.click(
		within(await screen.findByRole("dialog", { name: "評価を確定しますか？" })).getByRole(
			"button",
			{
				name: "評価を確定する",
			},
		),
	);
	await screen.findByRole("dialog", { name: "社員2 さんの評価シート" });
	expect(view.history.get()).toContain("sheet=102");
	expect(view.history.get()).not.toContain("mode=");
});
it("compares selected people in the same window, and returns to the comparison from a sheet", async () => {
	const view = setup([
		reviewerRow(1),
		reviewerRow(2),
		reviewerRow(3, { gradeId: 2, gradeName: "技術2級" }),
	]);
	fireEvent.click(await view.findByRole("checkbox", { name: "社員1を比較に選択" }));
	fireEvent.click(view.getByRole("checkbox", { name: "社員2を比較に選択" }));
	fireEvent.click(view.getByRole("button", { name: "選択して比較 2 / 6" }));
	// 比較は一覧の上の窓に出る。一覧は後ろに残る
	const comparison = within(await view.findByRole("dialog", { name: "選択した対象者の比較" }));
	comparison.getByRole("rowheader", { name: "一次・二次の差" });
	expect(comparison.getAllByText("二次評価の根拠")).toHaveLength(2);
	expect(comparison.getAllByText("計画に沿って達成")).toHaveLength(2);
	expect(comparison.queryByRole("heading", { name: "技術2級" })).toBeNull();
	expect(view.history.get()).toContain("compare=1");
	expect(view.history.get()).not.toContain("mode=");
	// 比較の中の氏名から評価シートを開き、比較に戻れる
	fireEvent.click(comparison.getByRole("button", { name: /社員2.*E002/ }));
	const sheetWindow = within(await view.findByRole("dialog", { name: "社員2 さんの評価シート" }));
	fireEvent.click(sheetWindow.getByRole("button", { name: "比較に戻る" }));
	await view.findByRole("dialog", { name: "選択した対象者の比較" });
	// 窓を閉じても、選んだ人はそのまま
	fireEvent.click(view.getByRole("button", { name: "閉じる" }));
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	expect(
		(view.getByRole("checkbox", { name: "社員1を比較に選択" }) as HTMLInputElement).checked,
	).toBe(true);
	fireEvent.click(view.getByRole("button", { name: "選択を解除" }));
	expect(
		(view.getByRole("checkbox", { name: "社員1を比較に選択" }) as HTMLInputElement).checked,
	).toBe(false);
});
it("starts with the reviewer's own turn, and sections the list by grade on request", async () => {
	const view = setup([
		reviewerRow(1, { status: "finalized" }),
		reviewerRow(2),
		reviewerRow(3, { gradeId: 2, gradeName: "技術2級" }),
	]);
	// タブは無い。一覧が唯一の画面で、評価も比較もここから始める
	await view.findByRole("button", { name: /社員1.*E001/ });
	expect(view.queryByRole("button", { name: "横断比較" })).toBeNull();
	expect(view.queryByRole("heading", { name: "技術2級" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "等級ごとに区切る" }));
	view.getByRole("heading", { name: "技術1級" });
	view.getByRole("heading", { name: "技術2級" });
	fireEvent.click(view.getByRole("button", { name: /自分の番を評価する（2）/ }));
	await view.findByRole("dialog", { name: "社員2 さんの評価シート" });
});
it("uses primary evaluators as labels and retains the filter while evaluating", async () => {
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
	// 「次へ」は絞り込んだ一覧の中で進む
	fireEvent.click(view.getByRole("button", { name: /社員1.*E001/ }));
	const sheetWindow = within(await view.findByRole("dialog", { name: "社員1 さんの評価シート" }));
	fireEvent.click(sheetWindow.getByRole("button", { name: "次へ" }));
	await view.findByRole("dialog", { name: "社員3 さんの評価シート" });
	fireEvent.click(view.getByRole("button", { name: "閉じる" }));
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
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
		await view.findByRole("button", { name: "一次評価者 井上 部長の部下で絞り込む" }),
	);
	expect(
		(view.getByRole("combobox", { name: "一次評価者で絞り込み" }) as HTMLSelectElement).value,
	).toBe("20");
	expect(view.queryByRole("button", { name: /社員2.*E002/ })).toBeNull();
});
it("shows primary judgment as read-only evidence while editing secondary evaluation", async () => {
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101");
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
		"/review?period=10&sheet=101",
	);
	const action = await view.findByRole("button", { name: "二次評価を確定する" });
	await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(action);
	// ランクは選ばせず、点数から決まった結果を確定前に見せる
	const dialog = await view.findByRole("dialog", { name: "評価を確定しますか？" });
	expect(dialog.textContent).toContain("最終評価ランクは S（95 点 / 100 点）");
	// 評価の確定は誰にも通知しない(次に動く人がいない)
	expect(within(dialog).queryByRole("checkbox")).toBeNull();
	// 確定の後に誰の評価へ進むかを、押す前に知らせる
	expect(dialog.textContent).toContain("確定後は、次の 社員3 さんの評価に進みます。");
	const updateStatus = vi.spyOn(view.editor.controller, "updateStatus");
	fireEvent.click(within(dialog).getByRole("button", { name: "評価を確定する" }));
	await waitFor(() => expect(updateStatus).toHaveBeenCalledWith(EvaluationStatus.FINALIZED, true));
	await waitFor(() => expect(view.history.get()).toContain("sheet=103"));
	await view.findByText("社員3 さんの評価に進みました");
	within(
		view.getByRole("checkbox", { name: "社員1を比較に選択" }).closest("tr") as HTMLElement,
	).getByText("最終評価済み");
});
it("goes to the person announced in the dialog even though confirming reorders the list", async () => {
	// 並びは「評価が必要な順」。社員2を確定すると社員2は末尾へ移り、並びだけで選ぶと先頭の社員1になる
	const view = setup(
		[reviewerRow(1), reviewerRow(2), reviewerRow(3)],
		"/review?period=10&sheet=102",
	);
	fireEvent.click(await view.findByRole("button", { name: "二次評価を確定する" }));
	const dialog = await view.findByRole("dialog", { name: "評価を確定しますか？" });
	expect(dialog.textContent).toContain("次の 社員3 さんの評価に進みます。");
	fireEvent.click(within(dialog).getByRole("button", { name: "評価を確定する" }));
	await waitFor(() => expect(view.history.get()).toContain("sheet=103"));
});
it("tells the reviewer when the sheet being confirmed is their last turn", async () => {
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101");
	fireEvent.click(await view.findByRole("button", { name: "二次評価を確定する" }));
	expect((await view.findByRole("dialog", { name: "評価を確定しますか？" })).textContent).toContain(
		"自分の番のシートは、これが最後です。",
	);
});
it("confirms the primary evaluation and notifies the secondary evaluator unless turned off", async () => {
	const view = setup([reviewerRow(1, submittedToPrimary)], "/review?period=10&sheet=101");
	const updateStatus = vi.spyOn(view.editor.controller, "updateStatus");
	fireEvent.click(await view.findByRole("button", { name: "一次評価を確定する" }));
	const dialog = await view.findByRole("dialog", { name: "一次評価を確定しますか？" });
	expect(dialog.textContent).toContain("一次評価ランクは B（70 点 / 100 点）");
	// 通知は初めから「送る」。送らないときだけチェックを外す
	const notify = within(dialog).getByRole("checkbox", {
		name: "二次評価者（徳永 優）に通知メールを送る",
	}) as HTMLInputElement;
	expect(notify.checked).toBe(true);
	fireEvent.click(notify);
	fireEvent.click(within(dialog).getByRole("button", { name: "一次評価を確定する" }));
	await waitFor(() =>
		expect(updateStatus).toHaveBeenCalledWith(EvaluationStatus.FIRST_EVALUATED, false),
	);
	await waitFor(() =>
		within(
			view.getByRole("checkbox", { name: "社員1を比較に選択" }).closest("tr") as HTMLElement,
		).getByText("二次評価する"),
	);
	// 確定後は一次評価を変更できない
	expect(
		(view.getByRole("textbox", { name: "一次評価者の総評" }) as HTMLTextAreaElement).readOnly,
	).toBe(true);
});
it("lets a secondary evaluator read but not evaluate before the primary evaluation is confirmed", async () => {
	const view = setup(
		[reviewerRow(1, { status: "submitted", firstRank: null })],
		"/review?period=10&sheet=101",
	);
	const second = await view.findByRole("textbox", { name: "二次評価者の総評" });
	expect((second as HTMLTextAreaElement).readOnly).toBe(true);
	expect(view.queryByRole("button", { name: /確定する/ })).toBeNull();
	expect(view.getByText(/一次評価を確定すると、二次評価を入力できるようになります/)).toBeTruthy();
});
it("blocks finalization of unsaved comments without losing the draft", async () => {
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101");
	const textarea = await view.findByRole("textbox", { name: "二次評価者の総評" });
	fireEvent.input(textarea, { target: { value: "書きかけの判断" } });
	fireEvent.click(view.getByRole("button", { name: "二次評価を確定する" }));
	expect(view.queryByRole("dialog", { name: /確定しますか/ })).toBeNull();
	expect((textarea as HTMLTextAreaElement).value).toBe("書きかけの判断");
});

it.each([
	{
		label: "primary",
		overrides: submittedToPrimary,
		scoreKey: "firstScore",
		button: "一次評価を確定する",
	},
	{ label: "secondary", overrides: {}, scoreKey: "secondScore", button: "二次評価を確定する" },
	{
		label: "primary final",
		overrides: { ...submittedToPrimary, primaryIsFinal: true, canViewSecond: false },
		scoreKey: "firstScore",
		button: "評価を確定する",
	},
] as const)(
	"shows missing own items and blocks $label confirmation before opening a dialog",
	async ({ overrides, scoreKey, button }) => {
		const row = reviewerRow(1, overrides);
		row.objectives = row.objectives.map((item) => ({ ...item, [scoreKey]: 0 }));
		row.commonItems = row.commonItems.map((item) => ({ ...item, [scoreKey]: 0 }));
		const view = setup([row], "/review?period=10&sheet=101");
		await view.findByText("自分の評価: あと 2 件");
		fireEvent.click(view.getByRole("button", { name: button }));
		expect(view.queryByRole("dialog", { name: /確定しますか/ })).toBeNull();
		const notice = view
			.getAllByRole("alert")
			.find((element) => element.classList.contains("evaluation-completion"));
		expect(notice?.textContent).toContain("チャレンジ目標 1");
		expect(notice?.textContent).toContain("共通評価「業務遂行」");
		expect(notice?.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
		// 未設定の項目を押すと、その行・その目標のタブへ移る
		const pending = within(notice as HTMLElement);
		fireEvent.click(pending.getByRole("button", { name: "共通評価「業務遂行」" }));
		expect(document.activeElement?.tagName).toBe("TR");
		expect(document.activeElement?.textContent).toContain("業務遂行");
		fireEvent.click(pending.getByRole("button", { name: "チャレンジ目標 1" }));
		expect(document.activeElement?.getAttribute("role")).toBe("tab");
		expect(row.status).not.toBe("finalized");
		expect(view.history.get()).toContain("sheet=101");
	},
);
it("allows confirmation after the remaining common evaluation is set and saved", async () => {
	const row = reviewerRow(1);
	row.commonItems[0].secondScore = 0;
	const view = setup([row], "/review?period=10&sheet=101");
	await view.findByText("自分の評価: あと 1 件");
	fireEvent.click(view.getByRole("button", { name: "二次評価を確定する" }));
	expect(view.queryByRole("dialog", { name: /確定しますか/ })).toBeNull();
	const commonCard = view
		.getByRole("heading", { name: "共通評価" })
		.closest(".common-evaluation-card") as HTMLElement;
	fireEvent.click(within(commonCard).getByRole("button", { name: "評価を入力" }));
	fireEvent.click(within(commonCard).getByRole("button", { name: "業務遂行 二次評価 3" }));
	// 長い表を入力し終えた位置(表の下)からも保存できる
	const saveButtons = within(commonCard).getAllByRole("button", { name: "評価を保存" });
	expect(saveButtons).toHaveLength(2);
	fireEvent.click(saveButtons[1]);
	await waitFor(() => expect(view.queryByText("自分の評価: あと 1 件")).toBeNull());
	fireEvent.click(view.getByRole("button", { name: "二次評価を確定する" }));
	const dialog = await view.findByRole("dialog", { name: "評価を確定しますか？" });
	fireEvent.click(within(dialog).getByRole("button", { name: "評価を確定する" }));
	await waitFor(() => expect(row.status).toBe("finalized"));
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
	const view = setup([reviewerRow(1)], "/review?period=10&sheet=101");
	await view.findByRole("textbox", { name: "二次評価者の総評" });
	view.controller.load.mockRejectedValueOnce(new Error("接続できません"));
	fireEvent.click(view.getByRole("button", { name: "部下の一覧を再読み込み" }));
	await view.findByRole("alert");
	expect(view.getByRole("textbox", { name: "二次評価者の総評" })).toBeTruthy();
});

it("shows an error dialog for an empty objective even when all scores are saved", async () => {
	const row = reviewerRow(1);
	row.objectives[0].challengeGoal = " ";
	const view = setup([row], "/review?period=10&sheet=101");
	const button = await view.findByRole("button", { name: "二次評価を確定する" });
	fireEvent.click(button);
	const dialog = await view.findByRole("dialog", { name: /空欄/ });
	expect(dialog.textContent).toContain("不要なタブを削除");
	expect(dialog.textContent).toContain("目標 1：チャレンジ目標");
	expect(row.status).not.toBe("finalized");
});
