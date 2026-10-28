import type { EmployeeMasterViewModel } from "../adapter/presenters/EmployeeMasterPresenter";
import type { ApprovalRelationDto } from "../application/dtos/EmployeeMasterDto";
import { reviewerRow } from "./reviewerFixture";

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

export const employeeMasterModel = (n: number): EmployeeMasterViewModel => ({
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

const statuses = ["draft", "goals_submitted", "submitted", "first_evaluated", "finalized"] as const;
export const reviewerRows = (n: number) =>
	Array.from({ length: n }, (_, i) =>
		reviewerRow(i + 1, {
			gradeId: i % 6,
			gradeName: `等級${i % 6}`,
			status: statuses[i % statuses.length],
			isPrimary: i % 3 === 0,
		}),
	);

export const reviewPeriods = [
	{ id: 10, periodName: "下期", startDate: "2026-10-01", endDate: "2027-03-31", isActive: true },
];
