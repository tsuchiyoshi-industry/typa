// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, test } from "vitest";
import { reviewPeriods as periods, reviewerRows as rowsOf } from "../../test/listBenchFixtures";
import { reviewerEditorFixture } from "../../test/reviewerEditorFixture";
import type { ReviewerWorkspaceController } from "../controllers/ReviewerWorkspaceController";
import ReviewerWorkspaceView from "./ReviewerWorkspaceView";

const samples = { iterations: 12, time: 0, warmupIterations: 3, warmupTime: 0 };
afterEach(cleanup);

for (const n of [30, 300]) {
	test(`reviewer workspace, ${n} rows`, async ({ bench }) => {
		const rows = rowsOf(n);
		const controller = { loadPeriods: async () => periods, load: async () => rows };
		const mount = async () => {
			render(() => (
				<MemoryRouter>
					<Route
						path="/"
						component={() => (
							<ReviewerWorkspaceView
								controller={controller as unknown as ReviewerWorkspaceController}
								editor={reviewerEditorFixture(() => rows)}
							/>
						)}
					/>
				</MemoryRouter>
			));
			await screen.findByText(`${n} 名を表示`);
		};
		await bench("mount and load the list", { afterEach: cleanup }, mount).run(samples);

		await mount();
		await bench("select 6 people, then clear", () => {
			const boxes = [...document.querySelectorAll<HTMLInputElement>("tbody input")];
			for (const box of boxes.filter((box) => !box.disabled).slice(0, 6)) {
				fireEvent.click(box);
			}
			const buttons = [...document.querySelectorAll("button")];
			fireEvent.click(buttons.find((button) => button.textContent === "選択を解除") as HTMLElement);
		}).run(samples);
		expect(document.querySelectorAll("tbody input:checked").length).toBe(0);

		const search = screen.getByRole("searchbox");
		await bench("type a search query, then clear", () => {
			for (const value of ["社", "社員", "社員1", ""]) {
				fireEvent.input(search, { target: { value } });
			}
		}).run(samples);
		expect(screen.getByText(`${n} 名を表示`)).toBeDefined();

		const toggle = document.querySelector(".review-toggle") as HTMLButtonElement;
		await bench("group by grade, then ungroup", () => {
			fireEvent.click(toggle);
			fireEvent.click(toggle);
		}).run(samples);
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
	});
}
