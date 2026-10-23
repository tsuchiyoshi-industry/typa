// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import { showToast } from "../feedback";
import PreviousGoalsView from "./PreviousGoalsView";

vi.mock("../feedback", () => ({ showToast: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const previous = (carried = false): PreviousGoals => ({
	periodName: "26期 上期",
	goals: [
		{
			id: 11,
			goalNumber: 1,
			challengeGoal: "目標A",
			midtermGoal: "",
			achievement: "達成",
			carried,
		},
		{
			id: 12,
			goalNumber: 2,
			challengeGoal: "目標B",
			midtermGoal: "",
			achievement: "",
			carried: false,
		},
	],
});

function setup(options: {
	loaded: PreviousGoals | null;
	canCarry?: boolean;
	carryOver?: (sheetId: number, goalId: number) => Promise<string | null>;
}) {
	const controller = {
		loadPreviousGoals: vi.fn().mockResolvedValue(options.loaded),
		carryOver: vi.fn(options.carryOver ?? (async () => null)),
	};
	const onCarried = vi.fn();
	const view = render(() => (
		<PreviousGoalsView
			sheetId={200}
			revision=""
			canCarry={options.canCarry ?? true}
			controller={controller}
			onCarried={onCarried}
		/>
	));
	return { controller, onCarried, view };
}

it("shows nothing when the employee had no sheet in the previous period, or it could not be read", async () => {
	const { controller, view } = setup({ loaded: null });
	await waitFor(() => expect(controller.loadPreviousGoals).toHaveBeenCalledWith(200));
	expect(view.container.textContent).toBe("");
});

it("keeps the goal as done and lets it be tried again when carrying it over fails", async () => {
	const { controller, onCarried, view } = setup({
		loaded: previous(),
		carryOver: async () => "チャレンジ目標は 4 件までです。",
	});
	const button = (await view.findAllByRole("button", { name: "続ける" }))[0];
	fireEvent.click(button);
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			"目標を引き継げませんでした",
			"チャレンジ目標は 4 件までです。",
		),
	);
	expect(onCarried).not.toHaveBeenCalled();
	expect(controller.carryOver).toHaveBeenCalledExactlyOnceWith(200, 11);
	await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
	expect(view.getAllByText("済み")).toHaveLength(2);
});

it("carries a goal over only once even when the button is pressed repeatedly", async () => {
	let finish: (value: string | null) => void = () => undefined;
	const { controller, view } = setup({
		loaded: previous(),
		carryOver: () => new Promise((resolve) => (finish = resolve)),
	});
	const buttons = await view.findAllByRole("button", { name: "続ける" });
	fireEvent.click(buttons[0]);
	fireEvent.click(buttons[0]);
	fireEvent.click(buttons[1]);
	finish(null);
	await waitFor(() => expect(controller.carryOver).toHaveBeenCalledOnce());
});

it("offers no carrying over once the sheet is no longer the employee's draft", async () => {
	const { view } = setup({ loaded: previous(true), canCarry: false });
	await view.findByText("継続中");
	expect(view.queryAllByRole("button", { name: "続ける" })).toHaveLength(0);
	expect((view.container.querySelector("details") as HTMLDetailsElement).open).toBe(false);
});
