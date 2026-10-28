import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { DEV } from "solid-js";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { browserSamples, painted, profileOperation, renderBench } from "../../test/browserBench";
import { reviewerRows, reviewPeriods } from "../../test/listBenchFixtures";
import { reviewerEditorFixture } from "../../test/reviewerEditorFixture";
import type { ReviewerWorkspaceController } from "../controllers/ReviewerWorkspaceController";
import ReviewerWorkspaceView from "./ReviewerWorkspaceView";

afterEach(cleanup);

test("reviewer workspace, 300 employees, Chromium with application CSS", async ({ bench }) => {
	expect(DEV).toBeUndefined();
	const rows = reviewerRows(300);
	const controller = { loadPeriods: async () => reviewPeriods, load: async () => rows };
	const mount = async () => {
		renderBench(() => (
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
	};
	await document.fonts.ready;
	await bench(
		"initial mount and fixture load to painted frame",
		{ afterEach: cleanup },
		async () => {
			await mount();
			await painted();
		},
	).run(browserSamples);
	await profileOperation("reviewer-workspace-300-mount", mount);
	expect(document.querySelectorAll("tbody tr").length).toBe(300);
	expect([innerWidth, innerHeight]).toEqual([1440, 900]);
	await page.screenshot({
		style: `body { height: ${innerHeight}px !important; overflow: hidden !important; }`,
	});

	const search = screen.getByRole("searchbox") as HTMLInputElement;
	const prepare = async () => {
		fireEvent.input(search, { target: { value: "社員" } });
		await painted();
	};
	const oneInput = () => fireEvent.input(search, { target: { value: "社員1" } });
	await bench("one input: 社員 → 社員1, to painted frame", { beforeEach: prepare }, async () => {
		oneInput();
		await painted();
	}).run(browserSamples);
	await prepare();
	await profileOperation("reviewer-workspace-300-input", oneInput);
	expect(screen.getByText("111 名を表示")).toBeDefined();

	fireEvent.input(search, { target: { value: "" } });
	await painted();
	const toggle = screen.getByRole("button", { name: "等級ごとに区切る" });
	const ungroup = async () => {
		if (toggle.getAttribute("aria-pressed") === "true") {
			fireEvent.click(toggle);
		}
		await painted();
	};
	const group = () => fireEvent.click(toggle);
	await bench("enable grouping once, to painted frame", { beforeEach: ungroup }, async () => {
		group();
		await painted();
	}).run(browserSamples);
	await ungroup();
	await profileOperation("reviewer-workspace-300-group", group);
	expect(toggle.getAttribute("aria-pressed")).toBe("true");
	expect(document.querySelectorAll("tbody tr").length).toBe(300);
});
