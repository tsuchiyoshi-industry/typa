// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import PreviousGoalsView from "./PreviousGoalsView";

afterEach(cleanup);
const previous = (carried: [number | null, number | null] = [null, null]): PreviousGoals => ({
	periodName: "26期 上期",
	goals: [
		{
			id: 11,
			goalNumber: 1,
			challengeGoal: "品質を高める",
			achievement: "",
			periodGoals: [{ description: "点検手順を見直す", achievement: "試行中" }],
			carriedInto: carried[0],
		},
		{
			id: 12,
			goalNumber: 2,
			challengeGoal: "後進を育てる",
			achievement: "2人が独り立ち",
			periodGoals: [],
			carriedInto: carried[1],
		},
	],
});
const objective = (goalNumber: number, challengeGoal: string): MilestoneDto => ({
	id: goalNumber + 100,
	sheetId: 200,
	goalNumber,
	challengeGoal,
	periodGoals: [],
	achievement: "",
	firstScore: null,
	secondScore: null,
});
function setup(
	props: Partial<{
		previous: PreviousGoals;
		objectives: MilestoneDto[];
		canCarry: boolean;
		hasRoom: boolean;
		carrying: number | null;
	}> = {},
) {
	const onCarry = vi.fn();
	const onOpen = vi.fn();
	const view = render(() => (
		<PreviousGoalsView
			previous={props.previous ?? previous()}
			objectives={props.objectives ?? []}
			canCarry={props.canCarry ?? true}
			hasRoom={props.hasRoom ?? true}
			carrying={props.carrying ?? null}
			onCarry={onCarry}
			onOpen={onOpen}
		/>
	));
	return { view, onCarry, onOpen };
}

it("offers to keep or revise each previous challenge goal while the subject drafts", () => {
	const { view, onCarry } = setup();
	expect((view.container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
	const first = view.getByRole("group", { name: "前期の目標 1 をどうするか" });
	fireEvent.click(first.querySelector("button") as HTMLButtonElement);
	expect(onCarry).toHaveBeenLastCalledWith(11, "keep");
	fireEvent.click(view.getAllByRole("button", { name: /見直して更新/ })[1]);
	expect(onCarry).toHaveBeenLastCalledWith(12, "revise");
	// 期中目標は、前期の記録として読むだけ
	expect(view.getByText("点検手順を見直す")).toBeTruthy();
	expect(view.getAllByText("前期の期中目標と達成状況", { selector: "summary" })).toHaveLength(2);
});

it("tells kept from revised goals by today's wording, and opens the goal it went to", () => {
	const { view, onOpen, onCarry } = setup({
		previous: previous([2, 1]),
		objectives: [objective(1, "後進を育て、任せる"), objective(2, "品質を高める")],
	});
	expect(view.getByText("目標 2 に据え置き")).toBeTruthy();
	expect(view.getByText("目標 1 で更新")).toBeTruthy();
	expect(view.queryByRole("button", { name: /据え置く/ })).toBeNull();
	expect(view.container.textContent).toContain("今期へ引き継ぎ 2件");
	fireEvent.click(view.getByRole("button", { name: /目標 2 を開く/ }));
	expect(onOpen).toHaveBeenCalledWith(2);
	expect(onCarry).not.toHaveBeenCalled();
});

it.each([
	["while another goal is being carried", { carrying: 11 }],
	["when this period has no room left", { hasRoom: false }],
])("disables the choice %s", (_, props) => {
	const { view } = setup(props);
	for (const button of view.getAllByRole("button", { name: /据え置く|見直して更新|引き継ぎ中/ })) {
		expect((button as HTMLButtonElement).disabled).toBe(true);
	}
	if ("hasRoom" in props) {
		expect(view.getByText(/上限に達しています/)).toBeTruthy();
	}
});

it("only shows the record to evaluators and after the goals are sent", () => {
	const { view } = setup({
		canCarry: false,
		previous: previous([1, null]),
		objectives: [objective(1, "品質を高める")],
	});
	expect((view.container.querySelector("details") as HTMLDetailsElement).open).toBe(false);
	expect(view.container.querySelector("fieldset")).toBeNull();
	expect(view.getByText("目標 1 に据え置き")).toBeTruthy();
	expect(view.getByText("今期には引き継いでいません")).toBeTruthy();
});
