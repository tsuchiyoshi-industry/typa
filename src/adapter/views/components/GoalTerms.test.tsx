// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { EvaluationSheetDto } from "../../../application/dtos/EvaluationSheetDto";
import { NO_SHEET_PERMISSIONS } from "../../../application/dtos/EvaluationSheetDto";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import type { SheetEditorViewModel } from "../../presenters/SheetEditorPresenter";
import { clearUnsavedChanges, showToast, trackUnsaved } from "../feedback";
import GoalTerms, { type GoalTerm } from "./GoalTerms";

vi.mock("../feedback", async (importOriginal) => ({
	...(await importOriginal<typeof import("../feedback")>()),
	confirmDiscard: vi.fn().mockResolvedValue(true),
	showToast: vi.fn(),
}));
afterEach(() => {
	cleanup();
	clearUnsavedChanges();
	vi.mocked(showToast).mockClear();
});

const goal = (goalNumber: number, challengeGoal: string): MilestoneDto => ({
	id: 100 + goalNumber,
	sheetId: 1,
	goalNumber,
	challengeGoal,
	periodGoals: [],
	achievement: "",
	firstScore: null,
	secondScore: null,
});
const previousGoals: PreviousGoals = {
	periodName: "26期 上期",
	goals: [
		{
			id: 7,
			goalNumber: 1,
			challengeGoal: "品質を高める",
			periodGoals: [],
			achievement: "",
			carriedInto: null,
		},
	],
};

function setup(
	previous: PreviousGoals | null = previousGoals,
	carryOver: ChallengeEvaluationController["carryOver"] = async () => ({ goalNumber: 1 }),
) {
	const [term, setTerm] = createSignal<GoalTerm>("current");
	const sheet = {
		sheetId: 1,
		objectives: [goal(1, "")],
		maxObjectives: 4,
	} as EvaluationSheetDto;
	const controller = {
		loadPreviousGoals: vi.fn(async () => previous),
		carryOver: vi.fn(carryOver),
	};
	const onUpdated = vi.fn(async () => {});
	const view = render(() => (
		<GoalTerms
			sheet={sheet}
			subject={{} as never}
			viewModel={
				{
					...NO_SHEET_PERMISSIONS,
					canEditMilestoneGoal: true,
					canCarryOverGoal: true,
				} as SheetEditorViewModel
			}
			term={term()}
			onTermChange={setTerm}
			controller={controller as unknown as ChallengeEvaluationController}
			challengeViewModel={() => ({ updating: false, updateError: null, updatedMilestoneId: null })}
			onUpdated={onUpdated}
			onSavingChange={() => {}}
		/>
	));
	const panel = (name: GoalTerm) =>
		view.container.querySelector<HTMLElement>(`#goal-term-panel-${name}`);
	return { ...view, controller, onUpdated, term, panel };
}

it("opens on this period, and keeps last period one tab away", async () => {
	const view = setup();
	const current = await view.findByRole("tab", { name: "当期" });
	expect(current.getAttribute("aria-selected")).toBe("true");
	expect(view.panel("current")?.hidden).toBe(false);
	expect(view.panel("previous")?.hidden).toBe(true);
	fireEvent.click(view.getByRole("tab", { name: /前期/ }));
	expect(view.term()).toBe("previous");
	expect(view.panel("previous")?.hidden).toBe(false);
	// 当期の画面は隠すだけ。書きかけの入力を消さない
	expect(view.panel("current")?.hidden).toBe(true);
	expect(view.panel("current")?.querySelector(".challenge-card")).toBeTruthy();
});

it("shows no tabs when there is nothing from last period", async () => {
	const view = setup(null);
	await waitFor(() => expect(view.controller.loadPreviousGoals).toHaveBeenCalled());
	expect(view.queryByRole("tablist", { name: "表示する期" })).toBeNull();
	expect(view.panel("current")?.hidden).toBe(false);
	expect(view.panel("previous")).toBeNull();
});

it("returns to this period with the goal open after carrying one over", async () => {
	const view = setup();
	fireEvent.click(await view.findByRole("tab", { name: /前期/ }));
	fireEvent.click(view.getByRole("button", { name: /据え置く/ }));
	await waitFor(() => expect(view.term()).toBe("current"));
	expect(view.controller.carryOver).toHaveBeenCalledWith(1, 7);
	expect(view.onUpdated).toHaveBeenCalled();
	expect(showToast).toHaveBeenCalledWith(
		"success",
		"前期の目標を、目標 1 に据え置きました",
		expect.any(String),
	);
});

it("stays on last period and says why when carrying over fails", async () => {
	const view = setup(previousGoals, async () => ({ error: "上限です" }));
	fireEvent.click(await view.findByRole("tab", { name: /前期/ }));
	fireEvent.click(view.getByRole("button", { name: /据え置く/ }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith("error", "前期の目標を引き継げませんでした", "上限です"),
	);
	expect(view.term()).toBe("previous");
	expect(view.onUpdated).not.toHaveBeenCalled();
	// 失敗の後も、もう一度選べる
	expect((view.getByRole("button", { name: /据え置く/ }) as HTMLButtonElement).disabled).toBe(
		false,
	);
});

it("does not carry over while something is still being written", async () => {
	createRoot(() => trackUnsaved("test-draft", () => true));
	const view = setup();
	fireEvent.click(await view.findByRole("tab", { name: /前期/ }));
	fireEvent.click(view.getByRole("button", { name: /据え置く/ }));
	expect(view.controller.carryOver).not.toHaveBeenCalled();
	expect(view.term()).toBe("previous");
});
