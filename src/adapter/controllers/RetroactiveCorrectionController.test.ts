import { expect, it, vi } from "vitest";
import { ChangeSheetGradeInteractor } from "../../application/usecases/ChangeSheetGradeInteractor";
import { PrivilegedSheetOperationInteractor } from "../../application/usecases/PrivilegedSheetOperationInteractor";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { masterRepository, period, profile, sheetRepository } from "../../test/fixtures";
import { RetroactiveCorrectionController } from "./RetroactiveCorrectionController";

const closed = EvaluationPeriod.restore({
	id: 9,
	termName: "25期",
	startDate: "2025-10-01",
	endDate: "2026-03-31",
	isActive: false,
	isClosed: true,
	allowUnfinalizedClose: false,
});

const setup = (role = "Admin") => {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role));
	const periods = { findDistinctPeriods: vi.fn().mockResolvedValue([closed, period()]) };
	employees.findGrades.mockResolvedValue([
		{ id: 2, name: "主任" },
		{ id: 1, name: "一般1級" },
	]);
	const repository = { execute: vi.fn().mockResolvedValue(undefined) };
	const gradeRepository = { execute: vi.fn().mockResolvedValue(2) };
	const sheets = sheetRepository();
	const controller = new RetroactiveCorrectionController(
		employees,
		periods,
		sheets,
		{ findClosedSheet: vi.fn() },
		{ execute: vi.fn() } as never,
		new PrivilegedSheetOperationInteractor(repository, employees),
		new ChangeSheetGradeInteractor(gradeRepository, employees),
	);
	return { periods, repository, gradeRepository, sheets, employees, controller };
};

it("refuses the page to a non-Admin before reading any period, even by direct URL", async () => {
	const { controller, periods } = setup("Reviewer");
	await expect(controller.periods()).rejects.toThrow("Admin");
	expect(periods.findDistinctPeriods).not.toHaveBeenCalled();
});

it("offers every period, newest first, with whether its values can still be corrected", async () => {
	const { controller } = setup();
	expect((await controller.periods()).map((entry) => [entry.id, entry.state])).toEqual([
		[10, "active"],
		[9, "closed"],
	]);
});

it("returns typed business failures and preserves a server error for the operator", async () => {
	const { controller, repository } = setup();
	const request = {
		sheetId: 100,
		expectedStatus: "finalized",
		action: "delete",
		reason: "再現テスト",
	};
	expect(await controller.operate({ ...request, reason: "" })).toEqual({
		success: false,
		message: "操作の理由を 500 文字以内で入力してください。",
	});
	expect(repository.execute).not.toHaveBeenCalled();
	repository.execute.mockRejectedValueOnce(new Error("シートの状態が変わりました"));
	expect(await controller.operate(request)).toEqual({
		success: false,
		message: "シートの状態が変わりました",
	});
	expect((await controller.operate(request)).success).toBe(true);
});

// ----- 等級を変える -----

const gradeRequest = {
	sheetId: 100,
	gradeId: 2,
	expectedGradeId: 1,
	expectedStatus: "submitted",
	reason: "等級の登録誤り",
};

it("lists each sheet with the grade it was created with", async () => {
	const { controller, sheets } = setup();
	sheets.findOverview.mockResolvedValue([
		{
			id: 100,
			periodId: 10,
			employeeName: "社員4",
			employeeNo: "E4",
			status: { toString: () => "submitted" },
			gradeId: 1,
			gradeName: "一般1級",
		},
		{
			id: 101,
			periodId: 10,
			employeeName: "社員5",
			employeeNo: "E5",
			status: { toString: () => "draft" },
			gradeId: null,
			gradeName: "",
		},
	] as never);
	expect(await controller.sheets(10)).toEqual([
		{
			sheetId: 100,
			employeeName: "社員4",
			employeeNo: "E4",
			status: "submitted",
			gradeId: 1,
			gradeName: "一般1級",
		},
		{
			sheetId: 101,
			employeeName: "社員5",
			employeeNo: "E5",
			status: "draft",
			gradeId: null,
			gradeName: "",
		},
	]);
});

it("offers the grades to choose from", async () => {
	const { controller } = setup();
	expect(await controller.grades()).toEqual([
		{ id: 2, name: "主任" },
		{ id: 1, name: "一般1級" },
	]);
});

it("changes a grade and reports how many common evaluation entries were deleted", async () => {
	const { controller, gradeRepository } = setup();
	expect(await controller.changeGrade(gradeRequest)).toEqual({
		success: true,
		message: "等級を変更し、共通評価の入力 2 件を削除しました。監査ログに記録しました。",
	});
	expect(gradeRepository.execute).toHaveBeenCalledOnce();
});

it.each([
	["a non-Admin", "Reviewer", gradeRequest, "等級の変更は Admin のみ利用できます。"],
	["the same grade", "Admin", { ...gradeRequest, gradeId: 1 }, "今と同じ等級には変更できません。"],
	[
		"no reason",
		"Admin",
		{ ...gradeRequest, reason: " " },
		"操作の理由を 500 文字以内で入力してください。",
	],
] as const)("refuses %s without touching the sheet", async (_, role, request, message) => {
	const { controller, gradeRepository } = setup(role);
	expect(await controller.changeGrade(request)).toEqual({ success: false, message });
	expect(gradeRepository.execute).not.toHaveBeenCalled();
});

it("shows the server's reason when it refuses, and a fallback when it gives none", async () => {
	const { controller, gradeRepository } = setup();
	gradeRepository.execute.mockRejectedValueOnce(new Error("シートの状態か等級が変わりました。"));
	expect(await controller.changeGrade(gradeRequest)).toEqual({
		success: false,
		message: "シートの状態か等級が変わりました。",
	});
	gradeRepository.execute.mockRejectedValueOnce({});
	expect(await controller.changeGrade(gradeRequest)).toEqual({
		success: false,
		message: "等級を変更できませんでした。",
	});
});
