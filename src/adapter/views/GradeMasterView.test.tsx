// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { GradeMaster } from "../../domain/entities/GradeMaster";
import { confirmAction, showToast } from "./feedback";
import GradeMasterView from "./GradeMasterView";

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
		{ id: 3, name: "技能1級", itemSetId: 2, employeeCount: 0, sheetCount: 0 },
	],
	itemSets: [
		{ id: 1, name: "一般", sheetCount: 3, items: [] },
		{ id: 2, name: "技能", sheetCount: 0, items: [] },
	],
};
const setup = () => {
	const controller = {
		load: vi.fn().mockResolvedValue(data),
		saveGrade: vi.fn().mockResolvedValue({ success: true, id: 9, message: "保存しました" }),
		deleteGrade: vi.fn().mockResolvedValue({ success: true, message: "削除しました" }),
	};
	const view = render(() => (
		<MemoryRouter>
			<Route path="/" component={() => <GradeMasterView controller={controller} />} />
		</MemoryRouter>
	));
	return { controller, view };
};
const nameInput = (view: ReturnType<typeof render>) =>
	view.getByRole("textbox", { name: "等級名" }) as HTMLInputElement;
const setSelect = (view: ReturnType<typeof render>) =>
	view.getByRole("combobox", { name: "共通目標" }) as HTMLSelectElement;

it("lists every grade with its common goals and how many employees and sheets use it", async () => {
	const { view } = setup();
	const rows = await view.findAllByRole("row");
	expect(rows.map((row) => row.textContent)).toEqual([
		"等級共通目標社員作成済みのシート操作",
		"一般1級一般7 人3 枚編集削除",
		"技能1級技能0 人0 枚編集削除",
	]);
});

it("adds a grade", async () => {
	const { view, controller } = setup();
	await view.findByText("一般1級");
	fireEvent.input(nameInput(view), { target: { value: "総合1級" } });
	fireEvent.change(setSelect(view), { target: { value: "2" } });
	fireEvent.click(view.getByRole("button", { name: "追加する" }));
	await waitFor(() =>
		expect(controller.saveGrade).toHaveBeenCalledWith({
			name: "総合1級",
			itemSetId: 2,
			shown: null,
		}),
	);
	expect(confirmAction).not.toHaveBeenCalled();
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "保存しました"));
	expect(controller.load).toHaveBeenCalledTimes(2);
	expect(nameInput(view).value).toBe("");
});

it("asks before moving a grade with sheets to other common goals, and says the sheets keep theirs", async () => {
	const { view, controller } = setup();
	fireEvent.click(await view.findByRole("button", { name: "一般1級を編集" }));
	await waitFor(() => expect(nameInput(view).value).toBe("一般1級"));
	fireEvent.change(setSelect(view), { target: { value: "2" } });
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	fireEvent.click(view.getByRole("button", { name: "変更を保存する" }));
	await waitFor(() =>
		expect(confirmAction).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("作成済みの評価シート 3 枚は、作成時の共通目標のまま"),
			}),
		),
	);
	expect(controller.saveGrade).not.toHaveBeenCalled();
	const saveButton = view.getByRole("button", { name: "変更を保存する" }) as HTMLButtonElement;
	await waitFor(() => expect(saveButton.disabled).toBe(false));
	fireEvent.click(saveButton);
	await waitFor(() =>
		expect(controller.saveGrade).toHaveBeenCalledWith({
			name: "一般1級",
			itemSetId: 2,
			shown: data.grades[0],
		}),
	);
});

it("renames without asking when the common goals stay", async () => {
	const { view, controller } = setup();
	fireEvent.click(await view.findByRole("button", { name: "一般1級を編集" }));
	await waitFor(() => expect(nameInput(view).value).toBe("一般1級"));
	fireEvent.input(nameInput(view), { target: { value: "一般Ⅰ級" } });
	fireEvent.click(view.getByRole("button", { name: "変更を保存する" }));
	await waitFor(() => expect(controller.saveGrade).toHaveBeenCalled());
	expect(confirmAction).not.toHaveBeenCalled();
});

it("keeps the input when saving fails", async () => {
	const { view, controller } = setup();
	controller.saveGrade.mockResolvedValueOnce({ success: false, message: "すでにあります" });
	await view.findByText("一般1級");
	fireEvent.input(nameInput(view), { target: { value: "一般1級" } });
	fireEvent.change(setSelect(view), { target: { value: "1" } });
	fireEvent.click(view.getByRole("button", { name: "追加する" }));
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", "すでにあります"));
	expect(nameInput(view).value).toBe("一般1級");
	expect(controller.load).toHaveBeenCalledTimes(1);
});

it("deletes a grade after asking", async () => {
	const { view, controller } = setup();
	fireEvent.click(await view.findByRole("button", { name: "技能1級を削除" }));
	await waitFor(() => expect(controller.deleteGrade).toHaveBeenCalledWith(data.grades[1]));
	expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger" }));
});

it("shows why the master cannot be read and offers to retry", async () => {
	const load = vi
		.fn()
		.mockRejectedValueOnce(new Error("等級と共通目標のマスタは Admin のみ利用できます。"))
		.mockResolvedValueOnce(data);
	const view = render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<GradeMasterView controller={{ load, saveGrade: vi.fn(), deleteGrade: vi.fn() }} />
				)}
			/>
		</MemoryRouter>
	));
	const alert = await view.findByRole("alert");
	expect(alert.textContent).toContain("Admin のみ利用できます");
	expect(view.queryByRole("table")).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "再読み込み" }));
	await view.findByText("一般1級");
});
