// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import type { PeriodGoal } from "../../../domain/valueObjects/PeriodGoal";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import { clearUnsavedChanges } from "../feedback";
import ChallengeEvaluationView, { type GoalFocus } from "./ChallengeEvaluationView";

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
function setup(
	initial: MilestoneDto[] = [],
	editable = true,
	achievements = false,
	previousGoals: PreviousGoals | null = null,
) {
	const [objectives, setObjectives] = createSignal(initial);
	const [focus, setFocus] = createSignal<GoalFocus | null>(null);
	let nextId = 20;
	let updatedMilestoneId: number | null = null;
	const controller = {
		upsertText: vi.fn(
			async (
				sheetId: number,
				goalNumber: number,
				challengeGoal: string,
				periodGoals: PeriodGoal[],
				achievement = "",
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
						periodGoals,
						achievement,
						firstScore: 0,
						secondScore: 0,
					},
				]);
				return true;
			},
		),
		updateText: vi.fn(
			async (
				_sheetId: number,
				id: number,
				challengeGoal: string,
				periodGoals: PeriodGoal[],
				achievement = "",
			) => {
				setObjectives((items) =>
					items.map((item) =>
						item.id === id ? { ...item, challengeGoal, periodGoals, achievement } : item,
					),
				);
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
			maxObjectives={4}
			subject={{} as never}
			canEditFirst={false}
			canEditSecond={false}
			canEditMilestoneGoal={editable}
			canEditMilestoneAchievement={achievements}
			canViewSecondEvaluation={false}
			controller={controller as unknown as ChallengeEvaluationController}
			viewModel={() => ({ updating: false, updateError: null, updatedMilestoneId })}
			onUpdated={() => {}}
			previousGoals={previousGoals}
			focus={focus()}
		/>
	));
	return { ...view, controller, objectives, setFocus };
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

it("saves separate tasks and their achievements under the selected challenge, without a completion action", async () => {
	const view = setup([
		{
			id: 11,
			sheetId: 100,
			goalNumber: 1,
			challengeGoal: "品質改善",
			achievement: "",
			periodGoals: [{ description: "手順を見直す", achievement: "試行中" }],
			firstScore: 0,
			secondScore: 0,
		},
	]);
	fireEvent.click(view.getByRole("button", { name: "目標を編集" }));
	fireEvent.click(view.getByRole("button", { name: "期中目標を追加" }));
	const task = view.getByRole("textbox", { name: "期中目標 2" });
	fireEvent.input(task, { target: { value: "研修を開く" } });
	expect(view.getByRole("textbox", { name: "期中目標 2" })).toBe(task);
	fireEvent.input(view.getByRole("textbox", { name: "達成状況 2" }), {
		target: { value: "参加者に案内した" },
	});
	expect(view.queryAllByRole("checkbox")).toHaveLength(0);
	fireEvent.click(view.getByRole("button", { name: "目標を保存" }));
	await waitFor(() =>
		expect(view.controller.updateText).toHaveBeenCalledWith(
			100,
			11,
			"品質改善",
			[
				{ description: "手順を見直す", achievement: "試行中" },
				{ description: "研修を開く", achievement: "参加者に案内した" },
			],
			"",
		),
	);
	await view.findByText("研修を開く");
	expect(view.getByText("参加者に案内した")).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "目標を編集" }));
	fireEvent.click(view.getByRole("button", { name: "期中目標 1 を削除" }));
	expect((view.getByRole("textbox", { name: "期中目標 1" }) as HTMLTextAreaElement).value).toBe(
		"研修を開く",
	);
	expect((view.getByRole("textbox", { name: "達成状況 1" }) as HTMLTextAreaElement).value).toBe(
		"参加者に案内した",
	);
	fireEvent.click(view.getByRole("button", { name: "期中目標 1 を削除" }));
	expect(view.queryByRole("textbox", { name: "期中目標 1" })).toBeNull();
	expect(view.getByRole("textbox", { name: /^達成状況$/ })).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "キャンセル" }));
	expect(view.getByText("手順を見直す")).toBeTruthy();
});

it("limits tasks to four while allowing the last one to be removed", () => {
	const view = setup();
	fireEvent.click(view.getByRole("button", { name: "目標を編集" }));
	const add = view.getByRole("button", { name: "期中目標を追加" });
	for (let i = 0; i < 4; i++) {
		fireEvent.click(add);
	}
	expect((add as HTMLButtonElement).disabled).toBe(true);
	expect(view.getAllByRole("textbox", { name: /^期中目標 [1-4]$/ })).toHaveLength(4);
});

it.each([0, 4])(
	"edits achievements without exposing goal changes after confirmation (%s tasks)",
	async (count) => {
		const tasks = Array.from({ length: count }, (_, i) => ({
			description: `タスク${i + 1}`,
			achievement: "",
		}));
		const view = setup(
			[
				{
					id: 11,
					sheetId: 100,
					goalNumber: 1,
					challengeGoal: "テーマ",
					achievement: "",
					periodGoals: tasks,
					firstScore: null,
					secondScore: null,
				},
			],
			false,
			true,
		);
		fireEvent.click(view.getByRole("button", { name: "達成状況を入力" }));
		expect(view.queryByRole("textbox", { name: "チャレンジ目標" })).toBeNull();
		expect(view.queryByRole("button", { name: "期中目標を追加" })).toBeNull();
		expect(view.queryByRole("button", { name: /期中目標 .* を削除/ })).toBeNull();
		fireEvent.input(view.getByRole("textbox", { name: count ? "達成状況 1" : "達成状況" }), {
			target: { value: "実施した結果" },
		});
		fireEvent.click(view.getByRole("button", { name: "達成状況を保存" }));
		await waitFor(() =>
			expect(view.controller.updateText).toHaveBeenCalledWith(
				100,
				11,
				"テーマ",
				count ? [{ ...tasks[0], achievement: "実施した結果" }, ...tasks.slice(1)] : [],
				count ? "" : "実施した結果",
			),
		);
	},
);

it("moves the theme's achievement into the first task instead of keeping it out of sight", async () => {
	const view = setup([
		{
			id: 11,
			sheetId: 100,
			goalNumber: 1,
			challengeGoal: "テーマ",
			achievement: "テーマの実績",
			periodGoals: [],
			firstScore: 0,
			secondScore: 0,
		},
	]);
	fireEvent.click(view.getByRole("button", { name: "目標を編集" }));
	fireEvent.click(view.getByRole("button", { name: "期中目標を追加" }));
	expect(view.queryByRole("textbox", { name: "達成状況" })).toBeNull();
	expect((view.getByRole("textbox", { name: "達成状況 1" }) as HTMLTextAreaElement).value).toBe(
		"テーマの実績",
	);
	fireEvent.click(view.getByRole("button", { name: "目標を保存" }));
	await waitFor(() =>
		expect(view.controller.updateText).toHaveBeenCalledWith(
			100,
			11,
			"テーマ",
			[{ description: "", achievement: "テーマの実績" }],
			"",
		),
	);
});

const carried = (challengeGoal: string, goalNumber = 2): MilestoneDto => ({
	id: 10 + goalNumber,
	sheetId: 100,
	goalNumber,
	challengeGoal,
	achievement: "",
	periodGoals: [],
	firstScore: 0,
	secondScore: 0,
});
const previous: PreviousGoals = {
	periodName: "26期 上期",
	goals: [
		{
			id: 7,
			goalNumber: 1,
			challengeGoal: "品質を高める",
			periodGoals: [],
			achievement: "",
			carriedInto: 2,
		},
	],
};

it("marks a goal kept from the previous period, and calls it revised once the wording changes", async () => {
	const view = setup([carried("", 1), carried("品質を高める")], true, false, previous);
	// 目標のタブには前期の印を付けない
	expect(view.getByRole("tab", { name: /目標 2/ }).querySelector("[aria-label]")).toBeNull();
	fireEvent.click(view.getByRole("tab", { name: /目標 2/ }));
	await waitFor(() => expect(view.getByText("前期から据え置き")).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "目標を編集" }));
	// 前期の文言は閉じてある。見たいときだけ開く
	const note = view.container.querySelector<HTMLDetailsElement>("details.continuity-note");
	expect(note?.open).toBe(false);
	expect(note?.querySelector("summary")?.textContent).toBe("26期 上期の文言を見る");
	fireEvent.input(view.getByRole("textbox", { name: /チャレンジ目標/ }), {
		target: { value: "品質を高め、手戻りを半分にする" },
	});
	expect(view.getByText("前期から更新")).toBeTruthy();
	// 前期の文言に戻せば、据え置きに戻る
	fireEvent.click(view.getByRole("button", { name: "前期の文言に戻す" }));
	expect((view.getByRole("textbox", { name: /チャレンジ目標/ }) as HTMLTextAreaElement).value).toBe(
		"品質を高める",
	);
	expect(view.getByText("前期から据え置き")).toBeTruthy();
});

it("does not set the old wording beside a revised goal, and marks nothing for a goal new to this period", () => {
	const view = setup([carried("品質を高め、任せる")], false, false, previous);
	expect(view.getByText("前期から更新")).toBeTruthy();
	expect(view.container.querySelector(".continuity-note")).toBeNull();
	expect(view.container.textContent).not.toContain("品質を高める");
	cleanup();
	const fresh = setup([carried("今期の新しい目標")], false, false, null);
	expect(fresh.container.querySelector(".continuity-badge")).toBeNull();
});

it("opens a goal from outside once it arrives, and starts writing this period's plan", async () => {
	const view = setup([carried("", 1)], true, false, previous);
	view.setFocus({ goalNumber: 2, edit: "plan", seq: 1 });
	// まだ読み直しが届いていない番号では、何もしない
	expect(view.getByRole("tab", { name: /目標 1/ }).getAttribute("aria-selected")).toBe("true");
	view.controller.upsertText(100, 2, "品質を高める", [], "");
	await waitFor(() =>
		expect(view.getByRole("tab", { name: /目標 2/ }).getAttribute("aria-selected")).toBe("true"),
	);
	expect(view.getByRole("button", { name: "期中目標を追加" })).toBeTruthy();
	expect(view.getByRole("textbox", { name: /チャレンジ目標/ })).toBeTruthy();
});
