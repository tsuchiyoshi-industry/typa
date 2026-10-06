import { vi } from "vitest";
import { CommonEvaluationItem } from "../domain/entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../domain/entities/CommonEvaluationResult";
import { Employee } from "../domain/entities/Employee";
import { EmployeeProfile } from "../domain/entities/EmployeeProfile";
import { EvaluationPeriod } from "../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../domain/entities/EvaluationSheet";
import { Milestone } from "../domain/entities/Milestone";
import type { CommonEvaluationRepository } from "../domain/repositories/CommonEvaluationRepository";
import type { EmployeeMasterRepository } from "../domain/repositories/EmployeeMasterRepository";
import type { EmployeeRepository } from "../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../domain/repositories/MilestoneRepository";
import { EvaluationStatus } from "../domain/valueObjects/EvaluationStatus";
import { FinalEvaluationRank } from "../domain/valueObjects/FinalEvaluationRank";

// Synthetic data only. Each factory returns fresh entities and mocks.
export const period = () =>
	new EvaluationPeriod(10, "テスト期間", "2026-04-01", "2026-09-30", true);
export const employee = () => new Employee(1, "テスト社員", "TEST001", 1, "技術", 5, 2, 3);
export const profile = (role = "Employee", id = 1, registered = true) =>
	new EmployeeProfile(
		id,
		`テスト${id}`,
		`TEST00${id}`,
		1,
		role,
		"技術",
		5,
		"等級",
		2,
		"一次",
		3,
		"二次",
		false,
		registered,
	);
export const milestone = () =>
	Milestone.create({
		id: 11,
		sheetId: 100,
		goalNumber: 1,
		challengeGoal: "目標",
		midtermGoal: "中間",
		achievement: "達成",
		firstScore: 2,
		secondScore: 4,
	});
export const commonResult = () =>
	CommonEvaluationResult.create({
		id: 21,
		sheetId: 100,
		itemId: 31,
		firstScore: 3,
		secondScore: 5,
		firstComment: "一次コメント",
		item: new CommonEvaluationItem(31, "共通項目", "説明", 5, 5),
	});
export const sheet = (status = EvaluationStatus.SUBMITTED) =>
	EvaluationSheet.create({
		sheetId: 100,
		subject: employee(),
		evaluationPeriod: period(),
		primaryEvaluatorName: "一次",
		secondaryEvaluatorName: "二次",
		firstOverallComment: "一次総評",
		secondOverallComment: "二次総評",
		objectives: [milestone()],
		commonEvaluationResults: [commonResult()],
		status,
		finalEvaluationRank: FinalEvaluationRank.from("A", "plus"),
	});
export const output = <T>() => ({ present: vi.fn<(response: T) => void>() });

export function sheetRepository() {
	return {
		findById: vi.fn<EvaluationSheetRepository["findById"]>().mockResolvedValue(sheet()),
		createOrGetSheet: vi.fn<EvaluationSheetRepository["createOrGetSheet"]>().mockResolvedValue(100),
		updateScoreTotals: vi
			.fn<EvaluationSheetRepository["updateScoreTotals"]>()
			.mockResolvedValue(undefined),
		updateFinalEvaluationRank: vi
			.fn<EvaluationSheetRepository["updateFinalEvaluationRank"]>()
			.mockResolvedValue(sheet()),
		updateOverallComment: vi
			.fn<EvaluationSheetRepository["updateOverallComment"]>()
			.mockResolvedValue(sheet()),
		updateStatus: vi
			.fn<EvaluationSheetRepository["updateStatus"]>()
			.mockImplementation(async (_id, status) => sheet(status)),
		findByOwner: vi.fn<EvaluationSheetRepository["findByOwner"]>().mockResolvedValue([]),
		findByEmployeeIds: vi
			.fn<EvaluationSheetRepository["findByEmployeeIds"]>()
			.mockResolvedValue([]),
		findExportData: vi.fn<EvaluationSheetRepository["findExportData"]>().mockResolvedValue(null),
	} satisfies EvaluationSheetRepository;
}
export function employeeRepository() {
	return {
		findCurrentEmployeeId: vi
			.fn<EmployeeRepository["findCurrentEmployeeId"]>()
			.mockResolvedValue({ data: 1, error: null }),
		findById: vi.fn<EmployeeRepository["findById"]>().mockResolvedValue(employee()),
		findByEmployeeNo: vi.fn<EmployeeRepository["findByEmployeeNo"]>().mockResolvedValue(employee()),
		findSubordinateIds: vi.fn<EmployeeRepository["findSubordinateIds"]>().mockResolvedValue([]),
		findEvaluatorNames: vi
			.fn<EmployeeRepository["findEvaluatorNames"]>()
			.mockResolvedValue({ primaryEvaluator: "一次", secondaryEvaluator: "二次" }),
		findGradeName: vi.fn<EmployeeRepository["findGradeName"]>().mockResolvedValue("等級"),
		findRegistrationStatus: vi
			.fn<EmployeeRepository["findRegistrationStatus"]>()
			.mockResolvedValue("available"),
		linkUserToEmployee: vi.fn<EmployeeRepository["linkUserToEmployee"]>().mockResolvedValue(true),
		checkUserLinked: vi.fn<EmployeeRepository["checkUserLinked"]>().mockResolvedValue(true),
	} satisfies EmployeeRepository;
}
export function milestoneRepository() {
	return {
		findBySheetId: vi.fn<MilestoneRepository["findBySheetId"]>().mockResolvedValue([milestone()]),
		updateText: vi.fn<MilestoneRepository["updateText"]>().mockResolvedValue(milestone()),
		upsertText: vi.fn<MilestoneRepository["upsertText"]>().mockResolvedValue(milestone()),
		updateScore: vi.fn<MilestoneRepository["updateScore"]>().mockResolvedValue(milestone()),
	} satisfies MilestoneRepository;
}
export function commonRepository() {
	return {
		findItemsByGrade: vi
			.fn<CommonEvaluationRepository["findItemsByGrade"]>()
			.mockResolvedValue([commonResult().item]),
		findResultsBySheetId: vi
			.fn<CommonEvaluationRepository["findResultsBySheetId"]>()
			.mockResolvedValue({
				results: [commonResult()],
				totalFirstScore: 3,
				totalSecondScore: 5,
				totalWeight: 5,
				firstRate: 60,
				secondRate: 100,
			}),
		createResultsForSheet: vi
			.fn<CommonEvaluationRepository["createResultsForSheet"]>()
			.mockResolvedValue(undefined),
		upsertResults: vi
			.fn<CommonEvaluationRepository["upsertResults"]>()
			.mockResolvedValue(undefined),
	} satisfies CommonEvaluationRepository;
}
export function masterRepository() {
	return {
		findCurrentEmployeeProfile: vi
			.fn<EmployeeMasterRepository["findCurrentEmployeeProfile"]>()
			.mockResolvedValue(profile("Reviewer", 2)),
		findAllEmployeeProfiles: vi
			.fn<EmployeeMasterRepository["findAllEmployeeProfiles"]>()
			.mockResolvedValue([profile()]),
		findByEmployeeNo: vi
			.fn<EmployeeMasterRepository["findByEmployeeNo"]>()
			.mockResolvedValue(profile()),
		findGrades: vi
			.fn<EmployeeMasterRepository["findGrades"]>()
			.mockResolvedValue([{ id: 5, name: "等級" }]),
		updateEvaluatorByEmployeeNo: vi
			.fn<EmployeeMasterRepository["updateEvaluatorByEmployeeNo"]>()
			.mockResolvedValue(profile()),
		updateGradeByEmployeeNo: vi
			.fn<EmployeeMasterRepository["updateGradeByEmployeeNo"]>()
			.mockResolvedValue(profile()),
		resetRegistrationByEmployeeNo: vi
			.fn<EmployeeMasterRepository["resetRegistrationByEmployeeNo"]>()
			.mockResolvedValue(true),
	} satisfies EmployeeMasterRepository;
}
