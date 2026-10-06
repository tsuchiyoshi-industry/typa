// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { ApprovalRelationDto } from "../../application/dtos/EmployeeMasterDto";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import EmployeeMasterView from "./EmployeeMasterView";
import { confirmAction } from "./feedback";

vi.mock("./feedback", () => ({
	confirmAction: vi.fn().mockResolvedValue(true),
	showToast: vi.fn(),
}));
afterEach(cleanup);

const employee = (
	id: number,
	name: string,
	careerCourse: string | null = "総合職",
): ApprovalRelationDto => ({
	employeeId: id,
	employeeNo: `E00${id}`,
	name,
	careerCourse,
	gradeId: 1,
	gradeName: "G1",
	primaryEvaluatorId: 2,
	primaryEvaluatorName: "鈴木",
	secondaryEvaluatorId: 3,
	secondaryEvaluatorName: "田中",
	noSecondaryEvaluator: false,
	registered: true,
});
function setup() {
	const [viewModel, setViewModel] = createSignal<EmployeeMasterViewModel>({
		loading: false,
		errorMessage: null,
		updateStatus: { message: null, success: null },
		mode: "admin",
		canEditEvaluators: true,
		canEditGrades: true,
		canResetRegistrations: true,
		currentEmployee: {
			id: 9,
			name: "管理者",
			employeeNo: "ADMIN",
			roleName: "Admin",
			careerCourse: "管理職",
			gradeName: "G3",
			primaryEvaluatorName: "未設定",
			secondaryEvaluatorName: "未設定",
		},
		relations: [employee(1, "山田"), employee(2, "鈴木"), employee(3, "田中", "役員")],
		grades: [
			{ id: 1, name: "G1" },
			{ id: 2, name: "G2" },
		],
	});
	const controller = {
		load: vi.fn().mockResolvedValue(undefined),
		updateGrade: vi.fn(async (employeeNo: string, gradeId: number) => {
			await Promise.resolve();
			setViewModel((prev) => ({
				...prev,
				relations: prev.relations.map((row) => ({
					...row,
					...(row.employeeNo === employeeNo ? { gradeId, gradeName: "G2" } : {}),
				})),
				grades: prev.grades.map((grade) => ({ ...grade })),
				updateStatus: { message: "更新しました", success: true },
			}));
			return true;
		}),
		updateEvaluator: vi.fn().mockResolvedValue(true),
		resetRegistration: vi.fn(),
	};
	const screen = render(() => (
		<EmployeeMasterView
			controller={controller as unknown as EmployeeMasterController}
			viewModel={viewModel}
		/>
	));
	return { ...screen, ...within(document.body), controller, setViewModel };
}
it("keeps the saved grade selected after rows and grade options are refreshed", async () => {
	const screen = setup();
	const select = screen.getByLabelText("山田さんの等級") as HTMLSelectElement;
	fireEvent.change(select, { target: { value: "2" } });
	await waitFor(() => expect(screen.controller.updateGrade).toHaveBeenCalledWith("E001", 2));
	await waitFor(() => expect(select.disabled).toBe(false));
	expect(select.value).toBe("2");
	screen.setViewModel((prev) => ({ ...prev, loading: true }));
	expect(select.value).toBe("2");
});

it("restores the current grade when confirmation is cancelled", async () => {
	vi.mocked(confirmAction).mockResolvedValueOnce(false);
	const screen = setup();
	const select = screen.getByLabelText("山田さんの等級") as HTMLSelectElement;
	fireEvent.change(select, { target: { value: "2" } });
	await waitFor(() => expect(select.value).toBe("1"));
	expect(screen.controller.updateGrade).not.toHaveBeenCalled();
});
it("restores the grade and enables controls when saving fails", async () => {
	const screen = setup();
	screen.controller.updateGrade.mockResolvedValueOnce(false);
	const select = screen.getByLabelText("山田さんの等級") as HTMLSelectElement;
	fireEvent.change(select, { target: { value: "2" } });
	await waitFor(() => expect(screen.controller.updateGrade).toHaveBeenCalled());
	await waitFor(() => expect(select.disabled).toBe(false));
	expect(select.value).toBe("1");
});
it("excludes executives from rows and counts but retains them as evaluator candidates", () => {
	const screen = setup();
	expect(screen.queryByLabelText("田中さんの等級")).toBeNull();
	expect(screen.getByRole("button", { name: /^全員\s*2$/ })).toBeTruthy();
	(screen.getByLabelText("山田さんの一次評価者") as HTMLInputElement).focus();
	expect(screen.getByRole("option", { name: /田中\s*E003/ })).toBeTruthy();
	expect(screen.queryByRole("option", { name: /山田\s*E001/ })).toBeNull();
});
it("filters by normalized employee number and chooses with the keyboard", async () => {
	const screen = setup();
	const input = screen.getByLabelText("山田さんの一次評価者") as HTMLInputElement;
	input.focus();
	fireEvent.input(input, { target: { value: "Ｅ００３" } });
	expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
	fireEvent.keyDown(input, { key: "Enter" });
	await waitFor(() =>
		expect(screen.controller.updateEvaluator).toHaveBeenCalledWith("E001", "E003", "primary"),
	);
	expect(screen.queryByRole("listbox")).toBeNull();
});
it("supports name search, empty results, Escape, and IME without saving typed text", () => {
	const screen = setup();
	const input = screen.getByLabelText("山田さんの一次評価者") as HTMLInputElement;
	input.focus();
	fireEvent.input(input, { target: { value: "田中" } });
	expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
	fireEvent.keyDown(input, { key: "Enter", isComposing: true });
	expect(screen.controller.updateEvaluator).not.toHaveBeenCalled();
	fireEvent.input(input, { target: { value: "いない人" } });
	expect(screen.getByText("一致する評価者がいません")).toBeTruthy();
	fireEvent.keyDown(input, { key: "Enter" });
	fireEvent.keyDown(input, { key: "Escape" });
	expect(input.value).toBe("鈴木");
	expect(screen.controller.updateEvaluator).not.toHaveBeenCalled();
});
it("confirms the explicit no-secondary option", async () => {
	const screen = setup();
	(screen.getByLabelText("山田さんの二次評価者") as HTMLInputElement).focus();
	fireEvent.click(screen.getByRole("option", { name: "なし（一次評価が最終評価）" }));
	await waitFor(() =>
		expect(screen.controller.updateEvaluator).toHaveBeenCalledWith("E001", null, "secondary"),
	);
});
