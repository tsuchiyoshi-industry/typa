// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { test } from "vitest";
import type { ApprovalRelationDto } from "../../application/dtos/EmployeeMasterDto";
import type { EmployeeMasterController } from "../controllers/EmployeeMasterController";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";
import EmployeeMasterView from "./EmployeeMasterView";

const employee = (id: number): ApprovalRelationDto => ({
	employeeId: id,
	employeeNo: `E${String(id).padStart(4, "0")}`,
	name: `社員${id}`,
	careerCourse: "総合職",
	roleName: "Employee",
	gradeId: 1,
	gradeName: "G1",
	primaryEvaluatorId: 1 + (id % 20),
	primaryEvaluatorName: `社員${1 + (id % 20)}`,
	secondaryEvaluatorId: 21 + (id % 5),
	secondaryEvaluatorName: `社員${21 + (id % 5)}`,
	noSecondaryEvaluator: false,
	isExecutive: false,
	hasUnsetAssignment: false,
	registered: true,
	keepSignedIn: false,
});
const relations = Array.from({ length: 300 }, (_, i) => employee(i + 1));
const [viewModel, setViewModel] = createSignal<EmployeeMasterViewModel>({
	loading: false,
	errorMessage: null,
	updateStatus: { message: null, success: null },
	invitations: [],
	mode: "admin",
	canEditEvaluators: true,
	canEditGrades: true,
	canEditRoles: true,
	canResetRegistrations: true,
	currentEmployee: {
		id: 1,
		name: "社員1",
		employeeNo: "E0001",
		roleName: "Admin",
		careerCourse: "総合職",
		gradeName: "G1",
		primaryEvaluatorName: "未設定",
		secondaryEvaluatorName: "未設定",
	},
	relations,
	grades: [
		{ id: 1, name: "G1" },
		{ id: 2, name: "G2" },
	],
});
const controller = { load: async () => {} } as unknown as EmployeeMasterController;
const mount = () =>
	render(() => <EmployeeMasterView controller={controller} viewModel={viewModel} />);

test("employee master screen, 300 employees", { timeout: 300_000 }, async ({ bench }) => {
	// happy-dom は外した DOM もしばらく手放さないので、出し直す回数は少なくする
	await bench("mount the list", () => {
		mount();
		cleanup();
	}).run({ iterations: 4, warmup: false, time: 0 });

	mount();
	// 保存のあとは、全員の行が新しいオブジェクトで届き直す
	await bench("reload all rows after a save", () => {
		setViewModel((prev) => ({ ...prev, relations: prev.relations.map((row) => ({ ...row })) }));
	}).run({ iterations: 10, time: 0 });
	await bench("type a search keyword, then clear", () => {
		const search = document.querySelector("input[type=search]") as HTMLInputElement;
		for (const value of ["社", "社員", "社員1", ""]) {
			fireEvent.input(search, { target: { value } });
		}
	}).run({ iterations: 10, time: 0 });
	cleanup();
});
