// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { test } from "vitest";
import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { reviewerEditorFixture } from "../../test/reviewerEditorFixture";
import { reviewerRow } from "../../test/reviewerFixture";
import type { ReviewerWorkspaceController } from "../controllers/ReviewerWorkspaceController";
import ReviewerWorkspaceView from "./ReviewerWorkspaceView";

const STATUSES = ["draft", "goals_submitted", "submitted", "first_evaluated", "finalized"] as const;
const rows: ReviewerRowDto[] = Array.from({ length: 300 }, (_, i) =>
	reviewerRow(i + 1, {
		gradeId: i % 6,
		gradeName: `等級${i % 6}`,
		status: STATUSES[i % STATUSES.length],
		isPrimary: i % 3 === 0,
	}),
);
const periods = [
	{ id: 10, periodName: "下期", startDate: "2026-10-01", endDate: "2027-03-31", isActive: true },
];

async function mount() {
	cleanup();
	const controller = { loadPeriods: async () => periods, load: async () => rows };
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
	await screen.findByText("300 名を表示");
}

// 画面を出したまま同じ操作をくり返す。どの操作も、終わると元の表示に戻す
test("reviewer workspace screen, 300 rows", { timeout: 300_000 }, async ({ bench }) => {
	await mount();
	await bench("select 6 people, then clear", () => {
		const boxes = [...document.querySelectorAll<HTMLInputElement>("tbody input")];
		for (const box of boxes.filter((box) => !box.disabled).slice(0, 6)) {
			fireEvent.click(box);
		}
		const buttons = [...document.querySelectorAll("button")];
		fireEvent.click(buttons.find((button) => button.textContent === "選択を解除") as HTMLElement);
	}).run({ iterations: 30, time: 0 });
	await bench("type a search query, then clear", () => {
		const search = document.querySelector("input[type=search]") as HTMLInputElement;
		for (const value of ["社", "社員", "社員1", ""]) {
			fireEvent.input(search, { target: { value } });
		}
	}).run({ iterations: 30, time: 0 });
	await bench("group by grade, then ungroup", () => {
		const toggle = document.querySelector(".review-toggle") as HTMLButtonElement;
		fireEvent.click(toggle);
		fireEvent.click(toggle);
	}).run({ iterations: 30, time: 0 });
	cleanup();
});
