// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { EmployeeMapDto, EmployeeMapPersonDto } from "../../application/dtos/EmployeeMapDto";
import EmployeeMapView from "./EmployeeMapView";

afterEach(cleanup);
const person = (id: number, primaryEvaluatorId: number | null): EmployeeMapPersonDto => ({
	id,
	name: `社員${id}`,
	employeeNo: `E00${id}`,
	gradeName: "G1",
	careerCourse: id === 1 ? "役員" : "技術",
	roleName: "Reviewer",
	primaryEvaluatorId,
	secondaryEvaluatorId: null,
	noSecondaryEvaluator: true,
	registered: true,
});
const data: EmployeeMapDto = {
	currentEmployeeId: 1,
	people: [person(1, null), person(2, 1), person(3, 2)],
};

it("searches hidden employees, expands their ancestors and shows read-only details", async () => {
	const load = vi.fn().mockResolvedValue(data);
	const view = render(() => <EmployeeMapView load={load} />);
	await view.findByRole("button", { name: "社員3 E003 の詳細" });
	fireEvent.click(view.getByRole("button", { name: "社員1の配下を折りたたむ" }));
	expect(view.queryByRole("button", { name: "社員3 E003 の詳細" })).toBeNull();
	fireEvent.input(view.getByRole("searchbox"), { target: { value: "Ｅ００３" } });
	const results = view.getByRole("region", { name: "社員の検索結果" });
	fireEvent.click(within(results).getByRole("button", { name: /社員3/ }));
	expect(view.getByRole("button", { name: "社員3 E003 の詳細" }).getAttribute("aria-pressed")).toBe(
		"true",
	);
	const detail = view.getByRole("complementary", { name: "選択した社員の詳細" });
	expect(within(detail).getByText("社員2")).toBeTruthy();
	expect(within(detail).getByText("なし（一次評価が最終）")).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "二次・最終評価者" }));
	expect(view.getByRole("button", { name: "二次・最終評価者" }).getAttribute("aria-pressed")).toBe(
		"true",
	);
	fireEvent.click(view.getByRole("button", { name: "縮小" }));
	expect(view.getByText("80%")).toBeTruthy();
	expect(load).toHaveBeenCalledTimes(1);
});
it("shows access denial without displaying employee information and supports retry", async () => {
	const load = vi
		.fn()
		.mockRejectedValueOnce(new Error("閲覧権限がありません"))
		.mockResolvedValueOnce(data);
	const view = render(() => <EmployeeMapView load={load} />);
	expect((await view.findByRole("alert")).textContent).toContain("閲覧権限がありません");
	expect(view.queryByRole("button", { name: "社員1 E001 の詳細" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "再読み込み" }));
	await view.findByRole("button", { name: "社員1 E001 の詳細" });
	expect(view.queryByRole("alert")).toBeNull();
});
it("clears old employee details if a refresh fails", async () => {
	const load = vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error("offline"));
	const view = render(() => <EmployeeMapView load={load} />);
	fireEvent.click(await view.findByRole("button", { name: "社員1 E001 の詳細" }));
	fireEvent.click(view.getByRole("button", { name: "マップを再読み込み" }));
	await view.findByRole("alert");
	expect(view.queryByRole("complementary")).toBeNull();
	expect(view.queryByRole("button", { name: "社員1 E001 の詳細" })).toBeNull();
});
