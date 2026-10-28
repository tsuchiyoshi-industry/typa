// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, test } from "vitest";
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

const viewModelOf = (n: number): EmployeeMasterViewModel => ({
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
	relations: Array.from({ length: n }, (_, i) => employee(i + 1)),
	grades: [
		{ id: 1, name: "G1" },
		{ id: 2, name: "G2" },
	],
});
const controller = { load: async () => {} } as unknown as EmployeeMasterController;

// DOM を出し直す操作は回数を絞り、ウォームアップも同じ条件で行う。
const samples = { iterations: 12, time: 0, warmupIterations: 3, warmupTime: 0 };
afterEach(cleanup);

for (const n of [30, 300]) {
	test(`employee master, ${n} employees`, async ({ bench }) => {
		const [viewModel, setViewModel] = createSignal(viewModelOf(n));
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
