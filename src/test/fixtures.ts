import { vi } from "vitest";
import { CommonEvaluationItem } from "../domain/entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../domain/entities/CommonEvaluationResult";
import { Employee } from "../domain/entities/Employee";
import { EmployeeProfile } from "../domain/entities/EmployeeProfile";
import { EvaluationPeriod } from "../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../domain/entities/EvaluationSheet";
import { Milestone } from "../domain/entities/Milestone";
import type { AuthRepository } from "../domain/repositories/AuthRepository";
import type { CommonEvaluationRepository } from "../domain/repositories/CommonEvaluationRepository";
import type { EmployeeMasterRepository } from "../domain/repositories/EmployeeMasterRepository";
import type { EmployeeRepository } from "../domain/repositories/EmployeeRepository";
import type { EvaluationPeriodRepository } from "../domain/repositories/EvaluationPeriodRepository";
import type { EvaluationSheetRepository } from "../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../domain/repositories/MilestoneRepository";
import { EmployeeRole } from "../domain/valueObjects/EmployeeRole";
import { EvaluationRank } from "../domain/valueObjects/EvaluationRank";
import { EvaluationStatus } from "../domain/valueObjects/EvaluationStatus";
import { SheetCountsByStatus } from "../domain/valueObjects/SheetCountsByStatus";

// Synthetic data only. Each factory returns fresh entities and mocks.
/** isActive が false の評価期間は、締め済み(シートのある評価期間は、実施中か締め済みのどちらか)。 */
export const period = (isActive = true, allowUnfinalizedClose = false) =>
	EvaluationPeriod.restore({
		id: 10,
		termName: "テスト期間",
		startDate: "2026-04-01",
		endDate: "2026-09-30",
		isActive,
		isClosed: !isActive,
		allowUnfinalizedClose,
	});
export const employee = () => new Employee(1, "テスト社員", "TEST001", 1, "技術", 5, 2, 3);
export const profile = (role = "Employee", id = 1, registered = true) =>
	new EmployeeProfile(
		id,
		`テスト${id}`,
		`TEST00${id}`,
		1,
		// 知らない名前は、DB から読んだときと同じく Employee になる
		EmployeeRole.fromStored(role),
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
		// 配点 5 の項目を、一次 3・二次 4(満点)で評価。得点は 15 / 20 と 20 / 20
		firstScore: 3,
		secondScore: 4,
		firstComment: "一次コメント",
		item: new CommonEvaluationItem(31, "共通項目", "説明", 5, 5),
	});
/** gradeId: シート作成時の等級。省略すると社員の今の等級(5)。periodClosed: 締めた評価期間のシート。 */
export const sheet = (
	status = EvaluationStatus.SUBMITTED,
	gradeId?: number | null,
	periodClosed = false,
	allowUnfinalizedClose = false,
) =>
	EvaluationSheet.create({
		sheetId: 100,
		subject: employee(),
		evaluationPeriod: period(!periodClosed, allowUnfinalizedClose),
		primaryEvaluatorName: "一次",
		secondaryEvaluatorName: "二次",
		firstOverallComment: "一次総評",
		secondOverallComment: "二次総評",
		objectives: [milestone()],
		commonEvaluationResults: [commonResult()],
		status,
		finalEvaluationRank: EvaluationRank.from("A", "plus"),
		gradeId,
	});
export const output = <T>() => ({ present: vi.fn<(response: T) => void>() });

export function sheetRepository() {
	return {
		findById: vi.fn<EvaluationSheetRepository["findById"]>().mockResolvedValue(sheet()),
		createOrGetSheet: vi.fn<EvaluationSheetRepository["createOrGetSheet"]>().mockResolvedValue(100),
		updateScoreTotals: vi
			.fn<EvaluationSheetRepository["updateScoreTotals"]>()
			.mockResolvedValue(undefined),
		updateOverallComment: vi
			.fn<EvaluationSheetRepository["updateOverallComment"]>()
			.mockResolvedValue(sheet()),
		updateStatus: vi
			.fn<EvaluationSheetRepository["updateStatus"]>()
			.mockImplementation(async (_id, status) => sheet(status)),
		findByOwner: vi.fn<EvaluationSheetRepository["findByOwner"]>().mockResolvedValue([]),
		findByEvaluator: vi.fn<EvaluationSheetRepository["findByEvaluator"]>().mockResolvedValue([]),
		findOverview: vi.fn<EvaluationSheetRepository["findOverview"]>().mockResolvedValue([]),
	} satisfies EvaluationSheetRepository;
}
export function employeeRepository() {
	return {
		findCurrentAccessState: vi
			.fn<EmployeeRepository["findCurrentAccessState"]>()
			.mockResolvedValue("unregistered"),
		findCurrentEmployeeId: vi
			.fn<EmployeeRepository["findCurrentEmployeeId"]>()
			.mockResolvedValue({ data: 1, error: null }),
		findGradeName: vi.fn<EmployeeRepository["findGradeName"]>().mockResolvedValue("等級"),
		beginRegistration: vi
			.fn<EmployeeRepository["beginRegistration"]>()
			.mockResolvedValue({ status: "available", token: "ticket" }),
		completeRegistration: vi
			.fn<EmployeeRepository["completeRegistration"]>()
			.mockResolvedValue(true),
		checkUserLinked: vi.fn<EmployeeRepository["checkUserLinked"]>().mockResolvedValue(true),
		findKeepSignedIn: vi.fn<EmployeeRepository["findKeepSignedIn"]>().mockResolvedValue(false),
	} satisfies EmployeeRepository;
}
export function milestoneRepository() {
	return {
		delete: vi.fn<MilestoneRepository["delete"]>().mockResolvedValue(undefined),
		updateText: vi.fn<MilestoneRepository["updateText"]>().mockResolvedValue(undefined),
		upsertText: vi.fn<MilestoneRepository["upsertText"]>().mockResolvedValue(undefined),
		updateScore: vi.fn<MilestoneRepository["updateScore"]>().mockResolvedValue(undefined),
		findPreviousGoals: vi.fn<MilestoneRepository["findPreviousGoals"]>().mockResolvedValue(null),
		carryOver: vi.fn<MilestoneRepository["carryOver"]>().mockResolvedValue(undefined),
	} satisfies MilestoneRepository;
}
export function commonRepository() {
	return {
		upsertResults: vi
			.fn<CommonEvaluationRepository["upsertResults"]>()
			.mockResolvedValue(undefined),
	} satisfies CommonEvaluationRepository;
}
export function masterRepository() {
	return {
		issueInvitationByEmployeeNo: vi
			.fn<EmployeeMasterRepository["issueInvitationByEmployeeNo"]>()
			.mockResolvedValue({ code: "invitation", expiresAt: "2026-12-01T00:00:00Z" }),
		issuePendingInvitations: vi
			.fn<EmployeeMasterRepository["issuePendingInvitations"]>()
			.mockResolvedValue([
				{ employeeNo: "TEST001", name: "テスト1", code: "a", expiresAt: "2026-12-01T00:00:00Z" },
				{ employeeNo: "TEST002", name: "テスト2", code: "b", expiresAt: "2026-12-01T00:00:00Z" },
			]),
		updateEnabledByEmployeeNo: vi
			.fn<EmployeeMasterRepository["updateEnabledByEmployeeNo"]>()
			.mockResolvedValue(true),
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
		updateKeepSignedInByEmployeeNo: vi
			.fn<EmployeeMasterRepository["updateKeepSignedInByEmployeeNo"]>()
			.mockResolvedValue(profile()),
		updateRoleByEmployeeNo: vi
			.fn<EmployeeMasterRepository["updateRoleByEmployeeNo"]>()
			.mockResolvedValue(true),
		resetRegistrationByEmployeeNo: vi
			.fn<EmployeeMasterRepository["resetRegistrationByEmployeeNo"]>()
			.mockResolvedValue(true),
		preRegisterEmployee: vi
			.fn<EmployeeMasterRepository["preRegisterEmployee"]>()
			.mockResolvedValue(true),
	} satisfies EmployeeMasterRepository;
}
export function authRepository() {
	return {
		getSession: vi.fn<AuthRepository["getSession"]>().mockResolvedValue(null),
		onAuthStateChange: vi.fn<AuthRepository["onAuthStateChange"]>().mockReturnValue(() => {}),
		signInWithPassword: vi
			.fn<AuthRepository["signInWithPassword"]>()
			.mockResolvedValue({ userId: "auth-user", error: null }),
		sendEmailCode: vi.fn<AuthRepository["sendEmailCode"]>().mockResolvedValue({ error: null }),
		verifyEmailCode: vi.fn<AuthRepository["verifyEmailCode"]>().mockResolvedValue({ error: null }),
		signUp: vi
			.fn<AuthRepository["signUp"]>()
			.mockResolvedValue({ status: "created", userId: "auth-user" }),
		signOut: vi.fn<AuthRepository["signOut"]>().mockResolvedValue(undefined),
		keepSignedIn: vi.fn<AuthRepository["keepSignedIn"]>(),
	} satisfies AuthRepository;
}
/** 締めた「前期」(1)、実施中の「今期」(2)、まだ始めていない「来期」(3)。今期のシートはすべて確定済み。 */
export function periodRepository() {
	const periods = [
		EvaluationPeriod.restore({
			id: 1,
			termName: "前期",
			startDate: "2025-04-01",
			endDate: "2026-03-31",
			isActive: false,
			isClosed: true,
		}),
		EvaluationPeriod.restore({
			id: 2,
			termName: "今期",
			startDate: "2026-04-01",
			endDate: "2027-03-31",
			isActive: true,
		}),
		EvaluationPeriod.restore({
			id: 3,
			termName: "来期",
			startDate: "2027-04-01",
			endDate: "2028-03-31",
			isActive: false,
		}),
	];
	return {
		findDistinctPeriods: vi
			.fn<EvaluationPeriodRepository["findDistinctPeriods"]>()
			.mockResolvedValue(periods),
		findById: vi
			.fn<EvaluationPeriodRepository["findById"]>()
			.mockImplementation(async (id) => periods.find((item) => item.id === id) ?? null),
		create: vi.fn<EvaluationPeriodRepository["create"]>().mockResolvedValue(true),
		update: vi.fn<EvaluationPeriodRepository["update"]>().mockResolvedValue(true),
		delete: vi.fn<EvaluationPeriodRepository["delete"]>().mockResolvedValue(true),
		activate: vi.fn<EvaluationPeriodRepository["activate"]>().mockResolvedValue(true),
		countSheetsByStatus: vi
			.fn<EvaluationPeriodRepository["countSheetsByStatus"]>()
			.mockImplementation(async (id) => SheetCountsByStatus.from(id === 3 ? {} : { finalized: 4 })),
	} satisfies EvaluationPeriodRepository;
}
