// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { GradeMaster } from "../../domain/entities/GradeMaster";
import CommonGoalMasterView from "./CommonGoalMasterView";
import { confirmAction, confirmDiscard, showToast } from "./feedback";

vi.mock("./feedback", () => ({
	confirmAction: vi.fn().mockResolvedValue(true),
	confirmDiscard: vi.fn().mockResolvedValue(true),
	showToast: vi.fn(),
	trackUnsaved: vi.fn(),
	trackSaving: vi.fn(),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const data: GradeMaster = {
	grades: [
		{ id: 1, name: "一般1級", itemSetId: 1, employeeCount: 7, sheetCount: 3 },
		{ id: 2, name: "一般2級", itemSetId: 1, employeeCount: 1, sheetCount: 0 },
	],
	itemSets: [
		{
			id: 1,
			name: "一般",
			sheetCount: 3,
			items: [
				{ id: 10, title: "協調性", description: "周りと協力する", weight: 2 },
				{ id: 11, title: "専門性", description: "", weight: 1 },
			],
		},
		{
			id: 2,
			name: "未使用",
			sheetCount: 0,
			items: [{ id: 12, title: "品質", description: "", weight: 1 }],
		},
	],
};
const setup = (makesNewVersion = false) => {
	const controller = {
		load: vi.fn().mockResolvedValue(data),
		saveCommonGoalSet: vi.fn().mockResolvedValue({ success: true, id: 5, message: "保存しました" }),
		deleteCommonGoalSet: vi.fn().mockResolvedValue({ success: true, message: "削除しました" }),
		makesNewVersion: vi.fn().mockReturnValue(makesNewVersion),
	};
	const view = render(() => (
		<MemoryRouter>
			<Route path="/" component={() => <CommonGoalMasterView controller={controller} />} />
		</MemoryRouter>
	));
	return { controller, view };
};
type View = ReturnType<typeof render>;
const title = (view: View, row: number) =>
	view.getByRole("textbox", { name: `${row} 行目の項目名` }) as HTMLInputElement;
const weight = (view: View, row: number) =>
	view.getByRole("spinbutton", { name: `${row} 行目の重み` }) as HTMLInputElement;
const picker = (view: View) =>
	view.getByRole("combobox", { name: "編集する共通目標" }) as HTMLSelectElement;

it("shows the first set's items, the grades that use it and that sheets keep their version", async () => {
	const { view } = setup();
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	expect(title(view, 2).value).toBe("専門性");
	expect(weight(view, 1).value).toBe("2");
	expect(view.getByText("一般1級・一般2級")).toBeTruthy();
	expect(view.getByText(/作成済みの評価シート 3 枚/).textContent).toContain("前の版のまま");
	expect([...picker(view).options].map((option) => option.textContent)).toEqual(["一般", "未使用"]);
});

it("saves every item with what was shown, and asks first when it makes a new version", async () => {
	const { view, controller } = setup(true);
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	fireEvent.input(weight(view, 1), { target: { value: "3" } });
	fireEvent.click(view.getByRole("button", { name: "項目を追加" }));
	fireEvent.input(title(view, 3), { target: { value: "安全" } });
	fireEvent.click(view.getByRole("button", { name: "保存する" }));
	await waitFor(() =>
		expect(confirmAction).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("作成済みの評価シート 3 枚は今の版のまま"),
			}),
		),
	);
	const request = {
		name: "一般",
		items: [
			{ id: 10, title: "協調性", description: "周りと協力する", weight: 3 },
			{ id: 11, title: "専門性", description: "", weight: 1 },
			{ id: null, title: "安全", description: "", weight: 1 },
		],
		shown: data.itemSets[0],
	};
	expect(controller.makesNewVersion).toHaveBeenLastCalledWith(request);
	await waitFor(() => expect(controller.saveCommonGoalSet).toHaveBeenCalledWith(request));
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "保存しました"));
	expect(controller.load).toHaveBeenCalledTimes(2);
});

it("does not save when the new version is not confirmed", async () => {
	const { view, controller } = setup(true);
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	fireEvent.click(view.getByRole("button", { name: "1 行目を削除" }));
	fireEvent.click(view.getByRole("button", { name: "保存する" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalled());
	expect(controller.saveCommonGoalSet).not.toHaveBeenCalled();
	expect(title(view, 1).value).toBe("専門性");
});

it("adds a new set from a blank form", async () => {
	const { view, controller } = setup();
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	fireEvent.click(view.getByRole("button", { name: "共通目標を追加" }));
	await waitFor(() => expect(title(view, 1).value).toBe(""));
	fireEvent.input(view.getByRole("textbox", { name: "名前" }), { target: { value: "管理職" } });
	fireEvent.input(title(view, 1), { target: { value: "判断" } });
	fireEvent.click(view.getByRole("button", { name: "保存する" }));
	await waitFor(() =>
		expect(controller.saveCommonGoalSet).toHaveBeenCalledWith({
			name: "管理職",
			items: [{ id: null, title: "判断", description: "", weight: 1 }],
			shown: null,
		}),
	);
	expect(confirmAction).not.toHaveBeenCalled();
});

it("keeps the input when saving fails", async () => {
	const { view, controller } = setup();
	controller.saveCommonGoalSet.mockResolvedValueOnce({
		success: false,
		message: "再読み込みしてください",
	});
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	fireEvent.input(title(view, 1), { target: { value: "協調性(直した)" } });
	fireEvent.click(view.getByRole("button", { name: "保存する" }));
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", "再読み込みしてください"));
	expect(title(view, 1).value).toBe("協調性(直した)");
});

it("asks before leaving unsaved items for another set, and stays when told to", async () => {
	const { view } = setup();
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	fireEvent.input(title(view, 1), { target: { value: "変えた" } });
	vi.mocked(confirmDiscard).mockResolvedValueOnce(false);
	fireEvent.change(picker(view), { target: { value: "2" } });
	await waitFor(() => expect(confirmDiscard).toHaveBeenCalledWith(true));
	expect(title(view, 1).value).toBe("変えた");
	expect(picker(view).value).toBe("1");
	fireEvent.change(picker(view), { target: { value: "2" } });
	await waitFor(() => expect(title(view, 1).value).toBe("品質"));
});

it("deletes a set after asking", async () => {
	const { view, controller } = setup();
	await waitFor(() => expect(title(view, 1).value).toBe("協調性"));
	fireEvent.change(picker(view), { target: { value: "2" } });
	await waitFor(() => expect(title(view, 1).value).toBe("品質"));
	fireEvent.click(view.getByRole("button", { name: "この共通目標を削除" }));
	await waitFor(() =>
		expect(controller.deleteCommonGoalSet).toHaveBeenCalledWith(data.itemSets[1], data.grades),
	);
	expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger" }));
});
