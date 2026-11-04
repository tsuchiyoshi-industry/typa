// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { EvaluationRankDto } from "../../../application/dtos/EvaluationSheetDto";
import ReviewActionBar from "./ReviewActionBar";

afterEach(cleanup);

const rank: EvaluationRankDto = {
	displayText: "A",
	score: 92,
	confirmed: false,
};

describe("review action guidance", () => {
	it("lights the confirmation action when the evaluator has completed every item", () => {
		const view = render(() => (
			<ReviewActionBar
				finalizing={false}
				primaryIsFinal={false}
				rank={rank}
				updating={false}
				busy={false}
				ready
				onConfirm={() => {}}
			/>
		));

		expect(
			view.getByRole("button", { name: "一次評価を確定する" }).classList.contains("is-ready"),
		).toBe(true);
	});

	it("does not light the confirmation action while evaluation items are incomplete", () => {
		const view = render(() => (
			<ReviewActionBar
				finalizing={true}
				primaryIsFinal={false}
				rank={rank}
				updating={false}
				busy={false}
				ready={false}
				onConfirm={() => {}}
			/>
		));

		expect(
			view.getByRole("button", { name: "二次評価を確定する" }).classList.contains("is-ready"),
		).toBe(false);
	});
});
