import { describe, expect, it, vi } from "vitest";
import { Employee } from "../../domain/entities/Employee";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	commonResult,
	employee,
	employeeRepository,
	milestone,
	output,
	period,
	sheetRepository,
} from "../../test/fixtures";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import { UpdateEvaluationStatusInteractor } from "./UpdateEvaluationStatusInteractor";

const cases = [
	{
		label: "primary confirmation",
		stage: "first",
		employeeId: 2,
		status: EvaluationStatus.SUBMITTED,
		next: EvaluationStatus.FIRST_EVALUATED,
		primaryIsFinal: false,
	},
	{
		label: "secondary confirmation",
		stage: "second",
		employeeId: 3,
		status: EvaluationStatus.FIRST_EVALUATED,
		next: EvaluationStatus.FINALIZED,
		primaryIsFinal: false,
	},
	{
		label: "primary final confirmation",
		stage: "first",
		employeeId: 2,
		status: EvaluationStatus.SUBMITTED,
		next: EvaluationStatus.FINALIZED,
		primaryIsFinal: true,
	},
] as const;

function setup(testCase: (typeof cases)[number], goalScore = 4, commonScore = 4) {
	const first = testCase.stage === "first";
	const current = EvaluationSheet.create({
		sheetId: 100,
		subject: testCase.primaryIsFinal
			? new Employee(1, "社員", "TEST001", 1, "技術", 5, 2, null, true)
			: employee(),
		evaluationPeriod: period(),
		primaryEvaluatorName: "一次",
		secondaryEvaluatorName: "二次",
		objectives: [
			milestone().withScoreUpdates({
				firstScore: first ? goalScore : 0,
				secondScore: first ? 0 : goalScore,
			}),
		],
		commonEvaluationResults: [
			first
				? commonResult().withFirstUpdate(commonScore, "")
				: commonResult().withFirstUpdate(0, "").withSecondUpdate(commonScore),
		],
		status: testCase.status,
	});
	const sheets = sheetRepository();
	sheets.findById.mockResolvedValue(current);
	const notifications = { notifyFirstEvaluationConfirmed: vi.fn(), notifySheetFinalized: vi.fn() };
	const request = { sheetId: 100, currentEmployeeId: testCase.employeeId, status: testCase.next };
	const useCase = new UpdateEvaluationStatusInteractor(sheets, employeeRepository(), notifications);
	return { current, sheets, notifications, request, useCase, out: output<never>() };
}

describe.each(cases)("$label", (testCase) => {
	it.each([
		[0, 4, "チャレンジ目標 1"],
		[4, 0, "共通評価「共通項目」"],
	])(
		"rejects unset goal/common %s/%s before any write or notification",
		async (goal, common, missing) => {
			const { sheets, notifications, request, useCase, out } = setup(testCase, goal, common);
			await expect(useCase.execute(request, out)).rejects.toThrow(missing);
			expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
			expect(sheets.updateStatus).not.toHaveBeenCalled();
			expect(notifications.notifyFirstEvaluationConfirmed).not.toHaveBeenCalled();
			expect(notifications.notifySheetFinalized).not.toHaveBeenCalled();
			expect(out.present).not.toHaveBeenCalled();
		},
	);
	it("reports all missing items together", async () => {
		const { request, useCase, out } = setup(testCase, 0, 0);
		await expect(useCase.execute(request, out)).rejects.toThrow(
			/2 件.*\n・チャレンジ目標 1\n・共通評価「共通項目」/,
		);
	});
	it("accepts complete own scores without requiring the other evaluator's scores or comments", async () => {
		const { sheets, request, useCase, out } = setup(testCase, 1, 1);
		await useCase.execute(request, out);
		expect(sheets.updateStatus).toHaveBeenCalledWith(100, testCase.next, expect.any(Object));
	});
	it("exposes own missing items for the evaluator who can confirm this stage", () => {
		const { current } = setup(testCase, 0, 0);
		const dto = toEvaluationSheetDto(
			current,
			"等級",
			EvaluationSheetAccessPolicy.for(testCase.employeeId, current),
		);
		expect(dto.pendingEvaluationItems).toEqual(["チャレンジ目標 1", "共通評価「共通項目」"]);
		const subjectDto = toEvaluationSheetDto(
			current,
			"等級",
			EvaluationSheetAccessPolicy.for(1, current),
		);
		expect(subjectDto.pendingEvaluationItems).toBeUndefined();
	});
});

it("checks every saved goal including the second one", () => {
	const { current } = setup(cases[0]);
	const twoGoals = EvaluationSheet.create({
		...current,
		objectives: [
			...current.objectives,
			Milestone.create({
				id: 12,
				sheetId: 100,
				goalNumber: 2,
				challengeGoal: "2つ目の目標",
				midtermGoal: "",
				achievement: "",
				firstScore: 0,
			}),
		],
	});
	// 実際の目標数で見る。未保存の2つ目のタブは評価項目として追加しない
	expect(current.pendingEvaluationItems("first")).toEqual([]);
	expect(twoGoals.pendingEvaluationItems("first")).toEqual(["チャレンジ目標 2"]);
});

it("does not require evaluations when the subject submits or reverts the sheet", async () => {
	for (const next of [EvaluationStatus.SUBMITTED, EvaluationStatus.DRAFT]) {
		const { current, sheets, useCase, out } = setup(cases[0], 0, 0);
		sheets.findById.mockResolvedValue(
			EvaluationSheet.create({
				...current,
				status:
					next === EvaluationStatus.SUBMITTED ? EvaluationStatus.DRAFT : EvaluationStatus.SUBMITTED,
			}),
		);
		await useCase.execute({ sheetId: 100, currentEmployeeId: 1, status: next }, out);
		expect(sheets.updateStatus).toHaveBeenCalled();
	}
});
