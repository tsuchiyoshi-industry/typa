// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { PeriodGoal } from "../../../domain/valueObjects/PeriodGoal";
import { PeriodGoalsEditor, PeriodGoalsList } from "./PeriodGoals";

afterEach(cleanup);

function setup(
	initial: PeriodGoal[],
	options: {
		canEditGoals?: boolean;
		canEditAchievements?: boolean;
		disabled?: boolean;
		achievement?: string;
	} = {},
) {
	const [state, setState] = createSignal({
		periodGoals: initial,
		achievement: options.achievement ?? "",
	});
	const onChange = vi.fn(setState);
	const view = render(() => (
		<PeriodGoalsEditor
			goals={state().periodGoals}
			achievement={state().achievement}
			canEditGoals={options.canEditGoals}
			canEditAchievements={options.canEditAchievements}
			disabled={options.disabled}
			onChange={onChange}
		/>
	));
	return { ...view, state, onChange };
}

const two: PeriodGoal[] = [
	{ description: "手順書を見直す", achievement: "8割" },
	{ description: "勉強会を開く", achievement: "" },
];

it("keeps each mid-term goal together with its own achievement", () => {
	const view = setup(two);
	const first = view.getByRole("group", { name: "期中目標 1" });
	expect(within(first).getByRole("textbox", { name: "期中目標 1" })).toBeTruthy();
	expect(within(first).getByRole("textbox", { name: "達成状況 1" })).toBeTruthy();
	expect(within(first).queryByRole("textbox", { name: "達成状況 2" })).toBeNull();
	expect(within(first).getByRole("button", { name: "期中目標 1 を削除" })).toBeTruthy();
	// 期中目標がある間は、チャレンジ目標そのものの達成状況の欄は出さない(どれに書くか迷わせない)
	expect(view.queryByRole("textbox", { name: /^達成状況$/ })).toBeNull();
});

it("shows how many goals are used out of the limit", () => {
	const view = setup(two);
	expect(view.getByText("2 / 4 件")).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "期中目標を追加" }));
	expect(view.getByText("3 / 4 件")).toBeTruthy();
});

it("renumbers the rest and keeps their text when a goal in the middle is removed", () => {
	const view = setup([...two, { description: "振り返りを書く", achievement: "済" }]);
	fireEvent.click(view.getByRole("button", { name: "期中目標 2 を削除" }));
	const second = view.getByRole("group", { name: "期中目標 2" });
	expect(
		(within(second).getByRole("textbox", { name: "期中目標 2" }) as HTMLTextAreaElement).value,
	).toBe("振り返りを書く");
	expect(
		(within(second).getByRole("textbox", { name: "達成状況 2" }) as HTMLTextAreaElement).value,
	).toBe("済");
	expect(view.queryByRole("group", { name: "期中目標 3" })).toBeNull();
});

it("moves the challenge's achievement into the first goal, and back when it is the last one removed", () => {
	const view = setup([], { achievement: "途中まで" });
	fireEvent.click(view.getByRole("button", { name: "期中目標を追加" }));
	expect((view.getByRole("textbox", { name: "達成状況 1" }) as HTMLTextAreaElement).value).toBe(
		"途中まで",
	);
	fireEvent.click(view.getByRole("button", { name: "期中目標 1 を削除" }));
	expect(view.getByRole("textbox", { name: /^達成状況$/ })).toBeTruthy();
	expect(view.getByText("0 / 4 件")).toBeTruthy();
});

it("lets only the achievement be written once the goals are fixed", () => {
	const view = setup(two, { canEditGoals: false });
	const first = view.getByRole("group", { name: "期中目標 1" });
	// 目標の文言は読めるが、書き換えも削除も追加もできない
	expect(within(first).getByText("手順書を見直す")).toBeTruthy();
	expect(within(first).queryByRole("textbox", { name: "期中目標 1" })).toBeNull();
	expect(within(first).getByRole("textbox", { name: "達成状況 1" })).toBeTruthy();
	expect(view.queryByRole("button", { name: /削除/ })).toBeNull();
	expect(view.queryByRole("button", { name: "期中目標を追加" })).toBeNull();
});

it("asks for no achievement while the goals are written, and keeps one written before", () => {
	const view = setup(two, { canEditAchievements: false });
	expect(view.queryByRole("textbox", { name: /達成状況/ })).toBeNull();
	expect(view.getByText(/達成状況は、一次評価者が目標を確定してから書きます/)).toBeTruthy();
	// 本文を直しても、以前に書かれた達成状況は消さずに送る
	fireEvent.input(view.getByRole("textbox", { name: "期中目標 1" }), {
		target: { value: "手順書を直す" },
	});
	expect(view.state().periodGoals[0]).toEqual({ description: "手順書を直す", achievement: "8割" });

	const theme = setup([], { canEditAchievements: false, achievement: "以前の実績" });
	expect(theme.queryByRole("textbox", { name: /達成状況/ })).toBeNull();
});

it("locks every field and button while saving", () => {
	const view = setup(two, { disabled: true });
	const fieldset = view.getByRole("group", { name: "期中目標 2 / 4 件" }) as HTMLFieldSetElement;
	expect(fieldset.disabled).toBe(true);
	// fieldset の disabled は中の部品すべてに及ぶ(個々の disabled 属性に頼らない)
	for (const control of fieldset.querySelectorAll("textarea, button")) {
		expect(control.closest("fieldset[disabled]")).toBe(fieldset);
	}
});

it("lists saved goals in the same numbered order as the editor", () => {
	const view = render(() => (
		<PeriodGoalsList goals={[...two, { description: "", achievement: "" }]} />
	));
	const items = within(view.getByRole("list", { name: "期中目標" })).getAllByRole("listitem");
	expect(items.map((item) => item.querySelector(".period-goals__number")?.textContent)).toEqual([
		"1",
		"2",
		"3",
	]);
	expect(within(items[0]).getByText("8割")).toBeTruthy();
	expect(within(items[2]).getByText("未入力")).toBeTruthy();
});
