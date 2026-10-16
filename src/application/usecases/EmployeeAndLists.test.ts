import { describe, expect, it, vi } from "vitest";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	employeeRepository,
	masterRepository,
	output,
	period,
	periodRepository,
	profile,
	sheet,
	sheetRepository,
} from "../../test/fixtures";
import { CreateEvaluationSheetInteractor } from "./CreateEvaluationSheetInteractor";
import { FetchCategorizedSheetsInteractor } from "./FetchCategorizedSheetsInteractor";
import { FetchDistinctPeriodsInteractor } from "./FetchDistinctPeriodsInteractor";
import { FetchEvaluationSheetInteractor } from "./FetchEvaluationSheetInteractor";
import { LoadEmployeeMasterInteractor } from "./LoadEmployeeMasterInteractor";
import { ResetEmployeeRegistrationInteractor } from "./ResetEmployeeRegistrationInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./UpdateEmployeeEvaluatorInteractor";
import { UpdateEmployeeGradeInteractor } from "./UpdateEmployeeGradeInteractor";

describe("employee master authorization", () => {
	it.each(["Admin", "Reviewer", "Employee", "unknown"])(
		"loads only what %s may edit",
		async (role) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 2));
			const out = output<never>();
			await new LoadEmployeeMasterInteractor(repo).execute({}, out);
			const editsEvaluators = role === "Admin";
			const viewsRelations = role === "Admin" || role === "Reviewer";
			expect(repo.findAllEmployeeProfiles).toHaveBeenCalledTimes(viewsRelations ? 1 : 0);
			expect(repo.findGrades).toHaveBeenCalledTimes(role === "Admin" ? 1 : 0);
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({
					canEditEvaluators: editsEvaluators,
					canEditGrades: role === "Admin",
					canResetRegistrations: role === "Admin",
					relations: viewsRelations ? [expect.objectContaining({ employeeNo: "TEST001" })] : [],
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
			expect.objectContaining({ currentEmployee: null, relations: [], grades: [] }),
		);
		expect(repo.findAllEmployeeProfiles).not.toHaveBeenCalled();
	});
	it.each(["Reviewer", "Employee", "unknown", null])(
		"denies evaluator update by %s",
		async (role) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role));
			const out = output<never>();
			await new UpdateEmployeeEvaluatorInteractor(repo).execute(
				{ targetEmployeeNo: "TEST001", evaluatorEmployeeNo: "TEST003", evaluatorType: "secondary" },
				out,
			);
			expect(repo.updateEvaluatorByEmployeeNo).not.toHaveBeenCalled();
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
		},
	);
	it.each([
		["Admin", "primary"],
		["Admin", "secondary"],
	] as const)("%s can update %s after normalizing numbers", async (role, evaluatorType) => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 2));
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
	});
	it("clears only the secondary evaluator", async () => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
		const out = output<never>();
		const interactor = new UpdateEmployeeEvaluatorInteractor(repo);
		await interactor.execute(
			{ targetEmployeeNo: "TEST001", evaluatorEmployeeNo: null, evaluatorType: "primary" },
			out,
		);
		expect(repo.updateEvaluatorByEmployeeNo).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenLastCalledWith(expect.objectContaining({ success: false }));
		await interactor.execute(
			{ targetEmployeeNo: "TEST001", evaluatorEmployeeNo: " ", evaluatorType: "secondary" },
			out,
		);
		expect(repo.updateEvaluatorByEmployeeNo).toHaveBeenCalledWith("TEST001", null, "secondary");
		expect(out.present).toHaveBeenLastCalledWith(expect.objectContaining({ success: true }));
	});
	it.each(["empty", "missingTarget", "missingEvaluator", "self", "failed"])(
		"rejects evaluator update case %s",
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
	it.each(["Reviewer", "Employee", "unknown", null])(
		"denies registration reset by %s",
		async (role) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role, 2));
			const out = output<never>();
			await new ResetEmployeeRegistrationInteractor(repo).execute(
				{ targetEmployeeNo: "TEST001" },
				out,
			);
			expect(repo.resetRegistrationByEmployeeNo).not.toHaveBeenCalled();
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
		},
	);
	it.each(["ok", "empty", "missingTarget", "self", "unregistered", "failed"])(
		"admin registration reset case %s",
		async (kind) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
			repo.findByEmployeeNo.mockResolvedValue(
				kind === "missingTarget"
					? null
					: profile("Employee", kind === "self" ? 2 : 1, kind !== "unregistered"),
			);
			if (kind === "failed") {
				repo.resetRegistrationByEmployeeNo.mockResolvedValue(false);
			}
			const out = output<never>();
			await new ResetEmployeeRegistrationInteractor(repo).execute(
				{ targetEmployeeNo: kind === "empty" ? " " : " TEST001 " },
				out,
			);
			const reachesRepository = kind === "ok" || kind === "failed";
			expect(repo.resetRegistrationByEmployeeNo).toHaveBeenCalledTimes(reachesRepository ? 1 : 0);
			if (reachesRepository) {
				expect(repo.resetRegistrationByEmployeeNo).toHaveBeenCalledWith("TEST001");
			}
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: kind === "ok" }));
		},
	);
	it.each(["Reviewer", "Employee", "unknown", null])("denies grade update by %s", async (role) => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role, 2));
		const out = output<never>();
		await new UpdateEmployeeGradeInteractor(repo).execute(
			{ targetEmployeeNo: "TEST001", gradeId: 5 },
			out,
		);
		expect(repo.updateGradeByEmployeeNo).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it.each(["ok", "empty", "missingTarget", "unknownGrade", "failed"])(
		"admin grade update case %s",
		async (kind) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
			if (kind === "missingTarget") {
				repo.findByEmployeeNo.mockResolvedValue(null);
			}
			if (kind === "failed") {
				repo.updateGradeByEmployeeNo.mockResolvedValue(null);
			}
			const out = output<never>();
			await new UpdateEmployeeGradeInteractor(repo).execute(
				{
					targetEmployeeNo: kind === "empty" ? " " : " TEST001 ",
					gradeId: kind === "unknownGrade" ? 99 : 5,
				},
				out,
			);
			const reachesRepository = kind === "ok" || kind === "failed";
			expect(repo.updateGradeByEmployeeNo).toHaveBeenCalledTimes(reachesRepository ? 1 : 0);
			if (reachesRepository) {
				expect(repo.updateGradeByEmployeeNo).toHaveBeenCalledWith("TEST001", 5);
			}
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: kind === "ok" }));
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
	it.each([{ evaluated: 0 }, { evaluated: 1 }])(
		"lists own sheets and the sheets that name the current employee as evaluator %j",
		async ({ evaluated }) => {
			const employees = employeeRepository();
			const sheets = sheetRepository();
			const summary = {
				id: 100,
				periodId: 10,
				employeeId: 1,
				status: EvaluationStatus.SUBMITTED,
				totalScore: 0,
				createdAt: "created",
				updatedAt: "updated",
				periodName: "test",
				periodStart: "start",
				periodEnd: "end",
				employeeName: "test",
				employeeNo: "TEST001",
				gradeName: "作成時の等級",
			};
			sheets.findByOwner.mockResolvedValue([summary]);
			sheets.findByEvaluator.mockResolvedValue(evaluated ? [summary] : []);
			const out = output<never>();
			await new FetchCategorizedSheetsInteractor(employees, sheets).execute({}, out);
			expect(sheets.findByOwner).toHaveBeenCalledWith(1);
			// 評価者はシートが持つもので引く(社員マスタの今の部下ではない)
			expect(sheets.findByEvaluator).toHaveBeenCalledExactlyOnceWith(1);
			expect(out.present.mock.calls[0][0]).toMatchObject({
				subordinateSheets: { length: evaluated },
			});
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({
					mySheets: [
						expect.objectContaining({
							startDate: "start",
							endDate: "end",
							totalScore: null,
							gradeName: "作成時の等級",
						}),
					],
				}),
			);
		},
	);
	it("maps periods and propagates repository failures", async () => {
		const repo = periodRepository();
		repo.findDistinctPeriods.mockResolvedValue([period()]);
		const out = output<never>();
		const interactor = new FetchDistinctPeriodsInteractor(repo);
		await interactor.execute({}, out);
		expect(out.present).toHaveBeenCalledWith({ periods: [period()] });
		repo.findDistinctPeriods.mockRejectedValue(new Error("DB"));
		await expect(interactor.execute({}, out)).rejects.toThrow("DB");
	});
	it("gives no permissions on a sheet that does not exist", async () => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(null);
		const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
		await new FetchEvaluationSheetInteractor(sheets, employeeRepository()).execute(
			{ sheetId: 100, currentEmployeeId: 2 },
			out,
		);
		expect(Object.values(out.present.mock.calls[0][0].permissions).every((value) => !value)).toBe(
			true,
		);
	});
	// シートを読めない人(4)は、権限を返す前に断る(SheetSecurity.test.ts)
	it.each([1, 2, 3])("resolves sheet-specific permissions for %s", async (id) => {
		const out = output<never>();
		// 提出済みは一次評価の段階。二次評価者は読めるが、一次評価が確定するまで入力できない
		await new FetchEvaluationSheetInteractor(sheetRepository(), employeeRepository()).execute(
			{ sheetId: 100, currentEmployeeId: id },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({
				permissions: expect.objectContaining({
					isSubject: id === 1,
					canEditFirst: id === 2,
					canEditSecond: false,
					canViewCommonEvaluation: id === 2 || id === 3,
					canConfirmFirstEvaluation: id === 2,
					canFinalizeEvaluation: false,
				}),
			}),
		);
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(sheet(EvaluationStatus.FIRST_EVALUATED));
		const next = output<never>();
		await new FetchEvaluationSheetInteractor(sheets, employeeRepository()).execute(
			{ sheetId: 100, currentEmployeeId: id },
			next,
		);
		expect(next.present).toHaveBeenCalledWith(
			expect.objectContaining({
				permissions: expect.objectContaining({
					canEditFirst: false,
					canEditSecond: id === 3,
					canConfirmFirstEvaluation: false,
					canFinalizeEvaluation: id === 3,
				}),
			}),
		);
	});
});

describe("sheet creation orchestration", () => {
	it("creates only the sheet: no evaluation is written on behalf of its subject", async () => {
		const sheets = sheetRepository();
		const out = output<never>();
		await new CreateEvaluationSheetInteractor(sheets, periodRepository()).execute(
			{ periodId: 2, employeeId: 1 },
			out,
		);
		expect(sheets.createOrGetSheet).toHaveBeenCalledWith(2, 1);
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith({ sheetId: 100 });
	});
	it("does not report success when the sheet cannot be created", async () => {
		const sheets = sheetRepository();
		sheets.createOrGetSheet.mockRejectedValue(new Error("DB"));
		const out = output<never>();
		await expect(
			new CreateEvaluationSheetInteractor(sheets, periodRepository()).execute(
				{ periodId: 2, employeeId: 1 },
				out,
			),
		).rejects.toThrow("DB");
		expect(out.present).not.toHaveBeenCalled();
	});
	it.each([
		["a closed period", 1],
		["a period that has not started", 3],
		["an unknown period", 999],
	])("creates a sheet only in the period in progress, not in %s", async (_label, periodId) => {
		const sheets = sheetRepository();
		const out = output<never>();
		await expect(
			new CreateEvaluationSheetInteractor(sheets, periodRepository()).execute(
				{ periodId, employeeId: 1 },
				out,
			),
		).rejects.toThrow("実施中の評価期間だけ");
		expect(sheets.createOrGetSheet).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it("draft role permissions are recalculated from current sheet", async () => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(sheet(EvaluationStatus.DRAFT));
		const out = output<never>();
		await new FetchEvaluationSheetInteractor(sheets, employeeRepository()).execute(
			{ sheetId: 100, currentEmployeeId: 1 },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({
				permissions: expect.objectContaining({
					canEditMilestoneGoal: true,
					canSubmitOwnSheet: true,
				}),
			}),
		);
	});
});
