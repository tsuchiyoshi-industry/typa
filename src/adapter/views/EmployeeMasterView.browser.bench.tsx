import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal, DEV } from "solid-js";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { browserSamples, painted, profileOperation, renderBench } from "../../test/browserBench";
import { employeeMasterModel } from "../../test/listBenchFixtures";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import EmployeeMasterView from "./EmployeeMasterView";

afterEach(cleanup);

test("employee master, 300 employees, Chromium with application CSS", async ({ bench }) => {
	expect(DEV).toBeUndefined();
	const [model] = createSignal(employeeMasterModel(300));
	const controller = { load: async () => {} } as unknown as EmployeeMasterController;
	const mount = () =>
		renderBench(() => <EmployeeMasterView controller={controller} viewModel={model} />);
	const mountPainted = async () => {
		mount();
		await painted();
	};
	await document.fonts.ready;
	await bench("initial mount to painted frame", { afterEach: cleanup }, mountPainted).run(
		browserSamples,
	);

	await profileOperation("employee-master-300-mount", mount);
	expect(document.querySelectorAll("tbody tr").length).toBe(300);
	expect(getComputedStyle(document.querySelector(".employee-master-page") as Element).display).toBe(
		"grid",
	);
	expect([innerWidth, innerHeight]).toEqual([1440, 900]);
	// Vitest screenshots the iframe body; clip it to the measured viewport.
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
	await profileOperation("employee-master-300-input", oneInput);
	expect(search.value).toBe("社員1");
	expect(document.querySelectorAll("tbody tr").length).toBe(111);
});
