// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, test } from "vitest";
import { employeeMasterModel } from "../../test/listBenchFixtures";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import EmployeeMasterView from "./EmployeeMasterView";

const controller = { load: async () => {} } as unknown as EmployeeMasterController;

// DOM を出し直す操作は回数を絞り、ウォームアップも同じ条件で行う。
const samples = { iterations: 12, time: 0, warmupIterations: 3, warmupTime: 0 };
afterEach(cleanup);

for (const n of [30, 300]) {
	test(`employee master, ${n} employees`, async ({ bench }) => {
		const [viewModel, setViewModel] = createSignal(employeeMasterModel(n));
		const mount = () =>
			render(() => <EmployeeMasterView controller={controller} viewModel={viewModel} />);

		// 後片付けはフックに置き、表示の計測時間から外す。
		await bench("mount the list", { afterEach: cleanup }, mount).run(samples);

		mount();
		const initialRows = document.querySelectorAll("tbody tr").length;
		expect(initialRows).toBe(n);
		await bench("reload all rows after a save", () => {
			setViewModel((previous) => ({
				...previous,
				relations: previous.relations.map((row) => ({ ...row })),
			}));
		}).run(samples);

		const search = screen.getByRole("searchbox");
		await bench("type a search keyword, then clear", () => {
			for (const value of ["社", "社員", "社員1", ""]) {
				fireEvent.input(search, { target: { value } });
			}
		}).run(samples);
		expect(document.querySelectorAll("tbody tr").length).toBe(initialRows);
	});
}
