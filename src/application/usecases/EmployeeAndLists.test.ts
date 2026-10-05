import { describe, expect, it, vi } from "vitest";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	commonRepository,
	employeeRepository,
	masterRepository,
	output,
	period,
	profile,
	sheet,
	sheetRepository,
} from "../../test/fixtures";
import { AssignEvaluatorInteractor } from "./AssignEvaluatorInteractor";
import { CheckEvaluatorRoleInteractor } from "./CheckEvaluatorRoleInteractor";
import { CreateEvaluationSheetInteractor } from "./CreateEvaluationSheetInteractor";
import { FetchCategorizedSheetsInteractor } from "./FetchCategorizedSheetsInteractor";
import { FetchDistinctPeriodsInteractor } from "./FetchDistinctPeriodsInteractor";
import { LoadEmployeeMasterInteractor } from "./LoadEmployeeMasterInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./UpdateEmployeeEvaluatorInteractor";

describe("employee master authorization", () => {
	it.each(["Admin", "Reviewer", "Employee", "unknown"])(
		"loads only allowed relations for %s",
		async (role) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 2));
			const out = output<never>();
			await new LoadEmployeeMasterInteractor(repo).execute({}, out);
			expect(repo.findAllEmployeeProfiles).toHaveBeenCalledTimes(role === "Admin" ? 1 : 0);
			expect(repo.findSubordinateProfiles).toHaveBeenCalledTimes(role === "Reviewer" ? 1 : 0);
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({
					canAssignEvaluators: role === "Reviewer",
					canViewAllRelations: role === "Admin",
				}),
			);
		},
	);
	it("missing identity cannot list employee relations", async () => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(null);
		const out = output<never>();
		await new LoadEmployeeMasterInteractor(repo).execute({}, out);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({ currentEmployee: null, relations: [] }),
		);
		expect(repo.findAllEmployeeProfiles).not.toHaveBeenCalled();
	});
	it.each(["Admin", "Employee", "unknown", null])("denies self assignment by %s", async (role) => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role, 2));
		const out = output<never>();
		await new AssignEvaluatorInteractor(repo).execute(
			{ employeeNo: "TEST001", evaluatorType: "primary" },
			out,
		);
		expect(repo.assignEvaluatorByEmployeeNo).not.toHaveBeenCalled();
		expect(repo.findByEmployeeNo).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it.each(["primary", "secondary"] as const)(
		"normalizes number and assigns reviewer as %s",
		async (evaluatorType) => {
			const repo = masterRepository();
			const out = output<never>();
			await new AssignEvaluatorInteractor(repo).execute(
				{ employeeNo: " TEST001 ", evaluatorType },
				out,
			);
			expect(repo.assignEvaluatorByEmployeeNo).toHaveBeenCalledWith("TEST001", 2, evaluatorType);
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
		},
	);
	it.each(["empty", "missing", "self", "failed"])("rejects assignment case %s", async (kind) => {
		const repo = masterRepository();
		if (kind === "missing") {
			repo.findByEmployeeNo.mockResolvedValue(null);
		}
		if (kind === "self") {
			repo.findByEmployeeNo.mockResolvedValue(profile("Reviewer", 2));
		}
		if (kind === "failed") {
			repo.assignEvaluatorByEmployeeNo.mockResolvedValue(null);
		}
		const out = output<never>();
		await new AssignEvaluatorInteractor(repo).execute(
			{ employeeNo: kind === "empty" ? " " : "TEST001", evaluatorType: "primary" },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
		expect(repo.assignEvaluatorByEmployeeNo).toHaveBeenCalledTimes(kind === "failed" ? 1 : 0);
	});
	it.each(["Reviewer", "Employee", "unknown", null])("denies admin update by %s", async (role) => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role));
		const out = output<never>();
		await new UpdateEmployeeEvaluatorInteractor(repo).execute(
			{ targetEmployeeNo: "TEST001", evaluatorEmployeeNo: "TEST003", evaluatorType: "secondary" },
			out,
		);
		expect(repo.updateEvaluatorByEmployeeNo).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it.each(["primary", "secondary"] as const)(
		"admin can update %s after normalizing numbers",
		async (evaluatorType) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin"));
			repo.findByEmployeeNo
				.mockResolvedValueOnce(profile())
				.mockResolvedValueOnce(profile("Reviewer", 3));
			const out = output<never>();
			await new UpdateEmployeeEvaluatorInteractor(repo).execute(
				{ targetEmployeeNo: " TEST001 ", evaluatorEmployeeNo: " TEST003 ", evaluatorType },
				out,
			);
			expect(repo.updateEvaluatorByEmployeeNo).toHaveBeenCalledWith(
				"TEST001",
				"TEST003",
				evaluatorType,
			);
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
		},
	);
	it.each(["empty", "missingTarget", "missingEvaluator", "self", "failed"])(
		"rejects admin update case %s",
		async (kind) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin"));
			repo.findByEmployeeNo
				.mockResolvedValueOnce(kind === "missingTarget" ? null : profile())
				.mockResolvedValueOnce(
					kind === "missingEvaluator" ? null : profile("Reviewer", kind === "self" ? 1 : 3),
				);
			if (kind === "failed") {
				repo.updateEvaluatorByEmployeeNo.mockResolvedValue(null);
			}
			const out = output<never>();
			await new UpdateEmployeeEvaluatorInteractor(repo).execute(
				{
					targetEmployeeNo: kind === "empty" ? " " : "TEST001",
					evaluatorEmployeeNo: "TEST003",
					evaluatorType: "primary",
				},
				out,
			);
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
			expect(repo.updateEvaluatorByEmployeeNo).toHaveBeenCalledTimes(kind === "failed" ? 1 : 0);
		},
	);
});

describe("lists and permission queries", () => {
	it.each(["missing", "error"])("missing identity fails closed (%s)", async (kind) => {
		const employees = employeeRepository();
		const sheets = sheetRepository();
		employees.findCurrentEmployeeId.mockResolvedValue({
			data: kind === "missing" ? null : 1,
			error: kind === "error" ? new Error("DB") : null,
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		const out = output<never>();
		await new FetchCategorizedSheetsInteractor(employees, sheets).execute({}, out);
		expect(out.present).toHaveBeenCalledWith({ mySheets: [], subordinateSheets: [] });
		expect(sheets.findByOwner).not.toHaveBeenCalled();
	});
	it.each([{ ids: [] }, { ids: [7, 8] }])(
		"queries only assigned subordinate IDs %j",
		async ({ ids }) => {
			const employees = employeeRepository();
			const sheets = sheetRepository();
			employees.findSubordinateIds.mockResolvedValue(ids);
			const summary = {
				id: 100,
				periodId: 10,
				employeeId: 1,
				status: "draft",
				totalScore: 0,
				createdAt: "created",
				updatedAt: "updated",
				periodName: "test",
				periodStart: "start",
				periodEnd: "end",
				employeeName: "test",
				employeeNo: "TEST001",
			};
			sheets.findByOwner.mockResolvedValue([summary]);
			sheets.findByEmployeeIds.mockResolvedValue([summary]);
			const out = output<never>();
			await new FetchCategorizedSheetsInteractor(employees, sheets).execute({}, out);
			expect(sheets.findByOwner).toHaveBeenCalledWith(1);
			expect(sheets.findByEmployeeIds).toHaveBeenCalledTimes(ids.length ? 1 : 0);
			if (ids.length) {
				expect(sheets.findByEmployeeIds).toHaveBeenCalledWith(ids);
			}
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({
					mySheets: [
						expect.objectContaining({ startDate: "start", endDate: "end", totalScore: null }),
					],
				}),
			);
		},
	);
	it("maps periods and propagates repository failures", async () => {
		const repo = { findDistinctPeriods: vi.fn().mockResolvedValue([period()]), findById: vi.fn() };
		const out = output<never>();
		const interactor = new FetchDistinctPeriodsInteractor(repo);
		await interactor.execute({}, out);
		expect(out.present).toHaveBeenCalledWith({ periods: [period()] });
		repo.findDistinctPeriods.mockRejectedValue(new Error("DB"));
		await expect(interactor.execute({}, out)).rejects.toThrow("DB");
	});
	it.each(["nullSheet", "missingSheet", "missingIdentity", "identityError"])(
		"returns no permissions for %s",
		async (kind) => {
			const employees = employeeRepository();
			const sheets = sheetRepository();
			if (kind === "missingSheet") {
				sheets.findById.mockResolvedValue(null);
			}
			if (kind === "missingIdentity") {
				employees.findCurrentEmployeeId.mockResolvedValue({ data: null, error: null });
			}
			if (kind === "identityError") {
				employees.findCurrentEmployeeId.mockResolvedValue({ data: 2, error: new Error("DB") });
			}
			vi.spyOn(console, "error").mockImplementation(() => {});
			const out = output<import("./CheckEvaluatorRoleInteractor").CheckEvaluatorRoleResponse>();
			await new CheckEvaluatorRoleInteractor(employees, sheets).execute(
				{ sheetId: kind === "nullSheet" ? null : 100 },
				out,
			);
			expect(Object.values(out.present.mock.calls[0][0]).every((value) => value === false)).toBe(
				true,
			);
		},
	);
	it.each([1, 2, 3, 4])("resolves sheet-specific permissions for %s", async (id) => {
		const employees = employeeRepository();
		employees.findCurrentEmployeeId.mockResolvedValue({ data: id, error: null });
		const out = output<never>();
		await new CheckEvaluatorRoleInteractor(employees, sheetRepository()).execute(
			{ sheetId: 100 },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({
				isSubject: id === 1,
				canEditFirst: id === 2,
				canEditSecond: id === 3,
				canViewCommonEvaluation: id === 2 || id === 3,
			}),
		);
	});
});

describe("sheet creation orchestration", () => {
	it("creates common results then refreshes totals", async () => {
		const sheets = sheetRepository();
		const common = commonRepository();
		const out = output<never>();
		const drafts = [{ itemId: 31, firstScore: 0, secondScore: 0, firstComment: "" }];
		await new CreateEvaluationSheetInteractor(sheets, common).execute(
			{ periodId: 10, employeeId: 1, drafts },
			out,
		);
		expect(sheets.createOrGetSheet).toHaveBeenCalledWith(10, 1);
		expect(common.createResultsForSheet).toHaveBeenCalledWith(100, drafts);
		expect(sheets.updateScoreTotals).toHaveBeenCalledWith(
			100,
			expect.objectContaining({
				commonEvaluationResults: expect.objectContaining({ secondTotalRate: 100 }),
			}),
		);
		expect(out.present).toHaveBeenCalledWith({ sheetId: 100 });
	});
	it("does not report success when common result persistence fails", async () => {
		const sheets = sheetRepository();
		const common = commonRepository();
		common.createResultsForSheet.mockRejectedValue(new Error("DB"));
		const out = output<never>();
		await expect(
			new CreateEvaluationSheetInteractor(sheets, common).execute(
				{ periodId: 10, employeeId: 1, drafts: [] },
				out,
			),
		).rejects.toThrow("DB");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it("does not fabricate totals when created sheet is not readable", async () => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(null);
		await new CreateEvaluationSheetInteractor(sheets, commonRepository()).execute(
			{ periodId: 10, employeeId: 1, drafts: [] },
			output<never>(),
		);
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it("draft role permissions are recalculated from current sheet", async () => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(sheet(EvaluationStatus.DRAFT));
		const out = output<never>();
		await new CheckEvaluatorRoleInteractor(employeeRepository(), sheets).execute(
			{ sheetId: 100 },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({ canEditMilestoneGoal: true, canSubmitOwnSheet: true }),
		);
	});
});
