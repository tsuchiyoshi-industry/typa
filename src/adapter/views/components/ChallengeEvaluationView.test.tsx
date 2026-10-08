// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import { clearUnsavedChanges } from "../feedback";
import ChallengeEvaluationView from "./ChallengeEvaluationView";

vi.mock("../feedback", async (importOriginal) => ({
	...(await importOriginal<typeof import("../feedback")>()),
	confirmAction: vi.fn().mockResolvedValue(true),
	confirmDiscard: vi.fn().mockResolvedValue(true),
	showToast: vi.fn(),
}));
afterEach(() => {
	cleanup();
	clearUnsavedChanges();
});
function setup(initial: MilestoneDto[] = [], editable = true) {
	const [objectives, setObjectives] = createSignal(initial);
	let nextId = 20;
	let updatedMilestoneId: number | null = null;
	const controller = {
		upsertText: vi.fn(
			async (
				sheetId: number,
				goalNumber: number,
				challengeGoal: string,
				midtermGoal: string,
				achievement: string,
			) => {
				const id = ++nextId;
				updatedMilestoneId = id;
				setObjectives((items) => [
					...items,
					{
						id,
						sheetId,
						goalNumber,
						challengeGoal,
						midtermGoal,
						achievement,
						firstScore: 0,
						secondScore: 0,
					},
				]);
				return true;
			},
		),
		delete: vi.fn(async (_sheetId: number, id: number) => {
			setObjectives((items) => items.filter((item) => item.id !== id));
			return true;
		}),
	};
	const view = render(() => (
		<ChallengeEvaluationView
			sheetId={100}
			objectives={objectives()}
			subject={{} as never}
			canEditFirst={false}
			canEditSecond={false}
			canEditMilestoneGoal={editable}
			canViewSecondEvaluation={false}
			controller={controller as unknown as ChallengeEvaluationController}
			viewModel={() => ({ updating: false, updateError: null, updatedMilestoneId })}
			onUpdated={() => {}}
		/>
	));
	return { ...view, controller, objectives };
}
it("adds empty tabs up to four, retains them on cancel, deletes and reuses a free number", async () => {
	const view = setup();
	expect(view.getAllByRole("tab")).toHaveLength(1);
	expect((view.getByRole("button", { name: "この目標を削除" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	for (const number of [2, 3, 4]) {
		fireEvent.click(view.getByRole("button", { name: "目標を追加" }));
		await waitFor(() => expect(view.getAllByRole("tab")).toHaveLength(number));
		await waitFor(() =>
			expect(view.getByRole("tab", { name: `目標 ${number}` }).getAttribute("aria-selected")).toBe(
				"true",
			),
		);
		fireEvent.click(view.getByRole("button", { name: "キャンセル" }));
	}
	expect(view.objectives()).toHaveLength(4);
	expect((view.getByRole("button", { name: "目標を追加" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	fireEvent.click(view.getByRole("tab", { name: "目標 2" }));
	await waitFor(() =>
		expect(view.getByRole("tab", { name: "目標 2" }).getAttribute("aria-selected")).toBe("true"),
	);
	fireEvent.click(view.getByRole("button", { name: "この目標を削除" }));
	await waitFor(() => expect(view.getAllByRole("tab")).toHaveLength(3));
	fireEvent.click(view.getByRole("button", { name: "目標を追加" }));
	await waitFor(() => expect(view.getAllByRole("tab")).toHaveLength(4));
	expect(
		view
			.objectives()
			.map((item) => item.goalNumber)
			.sort(),
	).toEqual([1, 2, 3, 4]);
});
it("hides add and delete controls from evaluators", () => {
	const view = setup([], false);
	expect(view.queryByRole("button", { name: "目標を追加" })).toBeNull();
	expect(view.queryByRole("button", { name: "この目標を削除" })).toBeNull();
});
