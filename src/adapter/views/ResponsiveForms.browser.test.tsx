import "./styles/global.css";
import "./styles/dashboard.css";
import "./styles/master.css";
import "./styles/review.css";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { reviewerEditorFixture } from "../../test/reviewerEditorFixture";
import { reviewerRow } from "../../test/reviewerFixture";
import FeedbackHost from "./components/FeedbackHost";
import { PeriodGoalsEditor } from "./components/PeriodGoals";
import { clearToasts, clearUnsavedChanges, settleConfirm } from "./feedback";
import ReviewerWorkspaceView from "./ReviewerWorkspaceView";

afterEach(() => {
	cleanup();
	clearUnsavedChanges();
	clearToasts();
	settleConfirm(false);
	document.documentElement.style.removeProperty("font-size");
});

function expectFits(element: HTMLElement) {
	expect(element.scrollWidth, element.className).toBeLessThanOrEqual(element.clientWidth + 1);
}

it.each([
	[320, 16],
	[390, 22],
	[1280, 16],
])("keeps review and scoring usable at %ipx with %ipx text", async (width, fontSize) => {
	await page.viewport(width, 844);
	document.documentElement.style.fontSize = `${fontSize}px`;
	const rows = [reviewerRow(1, { status: "submitted", isPrimary: true, firstRank: null })];
	const editor = reviewerEditorFixture(() => rows);
	const save = vi.spyOn(editor.commonEvaluationController, "upsert");
	const history = createMemoryHistory();
	history.set({ value: "/review", replace: true, scroll: false });
	const view = render(() => (
		<MemoryRouter
			history={history}
			root={(props) => (
				<main class="dashboard-main">
					{props.children}
					<FeedbackHost />
				</main>
			)}
		>
			<Route
				path="/review"
				component={() => (
					<ReviewerWorkspaceView
						controller={
							{
								loadPeriods: async () => [{ id: 10, periodName: "2026年度 下期", isActive: true }],
								load: async () => structuredClone(rows),
							} as never
						}
						editor={editor}
					/>
				)}
			/>
		</MemoryRouter>
	));
	const comparison = (await view.findByRole("checkbox", {
		name: "社員1を比較に選択",
	})) as HTMLInputElement;
	fireEvent.click(comparison.closest("label") as HTMLElement);
	await waitFor(() => expect(comparison.checked).toBe(true));
	expect(within(document.body).queryByRole("dialog")).toBeNull();
	fireEvent.click(view.getByRole("button", { name: /社員1.*E001/ }));
	const dialog = await within(document.body).findByRole("dialog", {
		name: "社員1 さんの評価シート",
	});
	const body = dialog.querySelector<HTMLElement>(".sheet-window__body");
	expectFits(body as HTMLElement);
	const common = dialog.querySelector<HTMLElement>(".common-evaluation-card") as HTMLElement;
	fireEvent.click(within(common).getByRole("button", { name: "評価を入力" }));
	const comment = within(common).getByRole("textbox", { name: "業務遂行 一次評価者コメント" });
	const score = within(common).getByRole("button", { name: "業務遂行 一次評価 4" });
	if (width < 769) {
		expectFits(common.querySelector<HTMLElement>(".table-scroll") as HTMLElement);
		expectFits(body as HTMLElement);
		const row = comment.closest("tr") as HTMLElement;
		for (const control of [comment, score]) {
			const bounds = control.getBoundingClientRect();
			expect(bounds.left).toBeGreaterThanOrEqual(row.getBoundingClientRect().left);
			expect(bounds.right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 1);
		}
		expect(score.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
		await waitFor(() => expect(score.getBoundingClientRect().height).toBeGreaterThanOrEqual(44));
		expect(Number.parseFloat(getComputedStyle(comment).fontSize)).toBeGreaterThanOrEqual(16);
	}
	fireEvent.input(comment, { target: { value: "改善活動を実施し品質を高めた" } });
	fireEvent.click(score);
	const saveButtons = within(common).getAllByRole("button", { name: "評価を保存" });
	fireEvent.click(saveButtons[saveButtons.length - 1]);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			101,
			expect.arrayContaining([
				expect.objectContaining({ firstScore: 4, firstComment: "改善活動を実施し品質を高めた" }),
			]),
		),
	);
	await waitFor(() => expect(within(common).queryByRole("textbox")).toBeNull());
	expectFits(dialog.querySelector<HTMLElement>(".review-action-bar") as HTMLElement);
});

it("gives period goals the available width and a touch sized delete action", async () => {
	await page.viewport(320, 844);
	const view = render(() => {
		const [goals, setGoals] = createSignal([{ description: "改善案を試す", achievement: "" }]);
		return (
			<main class="dashboard-main">
				<div class="objective-fields editing">
					<PeriodGoalsEditor
						goals={goals()}
						achievement=""
						onChange={(next) => setGoals(next.periodGoals)}
					/>
				</div>
			</main>
		);
	});
	const input = view.getByRole("textbox", { name: "期中目標 1" });
	expect(input.getBoundingClientRect().width).toBeGreaterThan(240);
	const remove = view.getByRole("button", { name: "期中目標 1 を削除" });
	expect(remove.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
	expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
	fireEvent.click(remove);
	expect(view.queryByRole("textbox", { name: "期中目標 1" })).toBeNull();
});
