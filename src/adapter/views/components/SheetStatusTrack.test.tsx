// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { ComponentProps } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EVALUATION_STATUS_VALUES,
	type EvaluationStatusValue,
} from "../../../domain/valueObjects/EvaluationStatus";
import SheetStatusTrack from "./SheetStatusTrack";

afterEach(cleanup);

type Props = ComponentProps<typeof SheetStatusTrack>;
const track = (overrides: Partial<Props> = {}) => {
	const props: Props = {
		status: "draft",
		primaryIsFinal: false,
		canSubmit: false,
		canRevert: false,
		canConfirmFirst: false,
		canFinalize: false,
		updating: false,
		notice: null,
		onSubmit: vi.fn(),
		onRevert: vi.fn(),
		onConfirmFirst: vi.fn(),
		onFinalize: vi.fn(),
		onConfirmGoals: vi.fn(),
		onRequestFirst: vi.fn(),
		...overrides,
	};
	render(() => <SheetStatusTrack {...props} />);
	return props;
};
const LABELS = [
	"下書き",
	"目標確認待ち",
	"振り返り待ち",
	"一次評価待ち",
	"二次評価待ち",
	"評価確定",
];

describe("the steps", () => {
	it.each(
		EVALUATION_STATUS_VALUES.flatMap((status) =>
			[false, true].map((primaryIsFinal) => [status, primaryIsFinal] as const),
		),
	)("at %s (primary is final: %s) marks the steps before it done", (status, primaryIsFinal) => {
		track({ status, primaryIsFinal });
		const steps = screen.getAllByRole("listitem");
		// 二次評価者「なし」の社員は「二次評価待ち」を通らない(以前のデータでその段にいれば出す)
		const expected = LABELS.filter(
			(label) => label !== "二次評価待ち" || !primaryIsFinal || status === "first_evaluated",
		);
		expect(steps.map((step) => step.textContent)).toEqual(expected);
		const current = expected.indexOf(LABELS[EVALUATION_STATUS_VALUES.indexOf(status)]);
		expect(steps.map((step) => step.getAttribute("aria-current"))).toEqual(
			expected.map((_, i) => (i === current ? "step" : null)),
		);
		expect(steps.map((step) => step.classList.contains("done"))).toEqual(
			expected.map((_, i) => i < current),
		);
	});
});

describe("the actions", () => {
	const actions = [
		["canSubmit", "onSubmit", "目標を送信する"],
		["canRevert", "onRevert", "要修正として下書きに戻す"],
		["canConfirmGoals", "onConfirmGoals", "目標を確定する"],
		["canRequestFirst", "onRequestFirst", "一次評価を依頼する"],
		["canConfirmFirst", "onConfirmFirst", "一次評価を確定する"],
		["canFinalize", "onFinalize", "二次評価を確定する"],
	] as const;

	it("offers nothing the viewer may not do", () => {
		track({ status: "submitted" });
		expect(screen.queryAllByRole("button")).toEqual([]);
	});

	it.each(actions)("offers %s as one button that does it once", (permission, handler, label) => {
		const props = track({ [permission]: true });
		expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([label]);
		fireEvent.click(screen.getByRole("button", { name: label }));
		expect(props[handler]).toHaveBeenCalledOnce();
	});

	// 状態の変更中と、保存した内容の読み直しが済むまでは押せない(古い内容で確定させない)
	it.each(
		actions.flatMap(([permission]) =>
			(["updating", "busy"] as const).map((state) => [permission, state] as const),
		),
	)("does not let %s be pressed while %s", (permission, state) => {
		track({ [permission]: true, [state]: true });
		expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
	});

	it("calls the final confirmation of a subject without a secondary evaluator just confirming", () => {
		track({ canFinalize: true, primaryIsFinal: true });
		expect(screen.getByRole("button").textContent).toBe("評価を確定する");
	});
});

describe("whose turn it is", () => {
	it.each([
		["goals_confirmed", { actor: "subject", name: "山田 太郎" }, "いまの担当：本人（山田 太郎）"],
		["submitted", { actor: "primary", name: "佐藤 花子" }, "いまの担当：一次評価者（佐藤 花子）"],
		[
			"first_evaluated",
			{ actor: "secondary", name: "鈴木 一郎" },
			"いまの担当：二次評価者（鈴木 一郎）",
		],
	] as const)("at %s names %o", (status, holder, text) => {
		track({ status: status as EvaluationStatusValue, holder });
		expect(screen.getByText(text)).toBeTruthy();
	});

	it("names nobody once the evaluation is finalized, and shows a notice as an alert", () => {
		track({ status: "finalized", holder: null, notice: "評価が確定しました" });
		expect(screen.queryByText(/いまの担当/)).toBeNull();
		expect(screen.getByRole("alert").textContent).toBe("評価が確定しました");
	});
});
