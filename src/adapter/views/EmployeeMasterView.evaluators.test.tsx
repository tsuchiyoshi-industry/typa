// @vitest-environment happy-dom
import { cleanup, render, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { ApprovalRelationDto } from "../../application/dtos/EmployeeMasterDto";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import EmployeeMasterView from "./EmployeeMasterView";

afterEach(cleanup);

const employee = (
	id: number,
	name: string,
	roleName: string | null,
	isExecutive = false,
	primaryEvaluatorId = 5,
): ApprovalRelationDto => ({
	employeeId: id,
	employeeNo: `E00${id}`,
	name,
	careerCourse: isExecutive ? "役員" : "総合職",
	roleName,
	gradeId: 1,
	gradeName: "G1",
	primaryEvaluatorId,
	primaryEvaluatorName: primaryEvaluatorId === 2 ? "鈴木" : "高橋",
	secondaryEvaluatorId: 3,
	secondaryEvaluatorName: "田中",
	noSecondaryEvaluator: false,
	isExecutive,
	hasUnsetAssignment: false,
	registered: true,
	keepSignedIn: false,
});

function setup() {
	const [viewModel] = createSignal<EmployeeMasterViewModel>({
		loading: false,
		errorMessage: null,
		updateStatus: { message: null, success: null },
		invitations: [],
		mode: "admin",
		canEditEvaluators: true,
		canEditGrades: true,
		canEditRoles: true,
		canResetRegistrations: false,
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
		relations: [
			// 山田の一次評価者は、評価者の権限を持たない鈴木(このきまりより前に設定された値)
			employee(1, "山田", "Employee", false, 2),
			employee(2, "鈴木", "Employee"),
			employee(3, "田中", "Employee", true),
			employee(4, "佐藤", "Reviewer"),
			employee(5, "高橋", "Admin"),
			employee(6, "伊藤", null),
		],
		grades: [{ id: 1, name: "G1" }],
	});
	const controller = { load: vi.fn() } as unknown as EmployeeMasterController;
	return render(() => <EmployeeMasterView controller={controller} viewModel={viewModel} />);
}

const optionNames = () =>
	within(document.querySelector(".evaluator-menu") as HTMLElement)
		.getAllByRole("option")
		.map((option) => option.textContent);

it("offers only Admin, Reviewer and executives as evaluators", () => {
	const screen = setup();
	(screen.getByLabelText("佐藤さんの一次評価者") as HTMLInputElement).focus();
	expect(optionNames()).toEqual(["田中E003", "高橋E005"]);
});

it("keeps showing a current evaluator who no longer qualifies, without offering them elsewhere", () => {
	const screen = setup();
	const yamada = screen.getByLabelText("山田さんの一次評価者") as HTMLInputElement;
	expect(yamada.value).toBe("鈴木");
	yamada.focus();
	expect(optionNames()).toEqual(["鈴木E002", "田中E003", "佐藤E004", "高橋E005"]);
	// 鈴木を選んでいない行には、鈴木は出ない
	yamada.blur();
	(screen.getByLabelText("伊藤さんの一次評価者") as HTMLInputElement).focus();
	expect(optionNames()).not.toContain("鈴木E002");
	yamada.blur();
	// 二次評価者には「なし」が先頭に付き、自分自身は出ない
	(screen.getByLabelText("佐藤さんの二次評価者") as HTMLInputElement).focus();
	expect(optionNames()).toEqual(["なし（一次評価が最終評価）", "田中E003", "高橋E005"]);
});
