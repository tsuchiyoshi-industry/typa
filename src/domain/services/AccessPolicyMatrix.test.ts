import { describe, expect, it } from "vitest";
import { toEvaluationSheetDto } from "../../application/dtos/EvaluationSheetMapper";
import { period, sheet } from "../../test/fixtures";
import { Employee } from "../entities/Employee";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { EvaluationSheetAccessPolicy } from "./EvaluationSheetAccessPolicy";

describe("authorization matrix", () => {
	for (const status of [
		EvaluationStatus.DRAFT,
		EvaluationStatus.SUBMITTED,
		EvaluationStatus.FINALIZED,
	]) {
		it.each([1, 2, 3, 4, null])(
			`enforces every permission in ${status.toString()} for %s`,
			(id) => {
				const policy = EvaluationSheetAccessPolicy.for(id, sheet(status));
				const evaluating = status === EvaluationStatus.SUBMITTED;
				expect(policy.canViewSheet()).toBe(id === 1 || id === 2 || id === 3);
				expect(policy.canEditMilestoneGoal()).toBe(id === 1 && status === EvaluationStatus.DRAFT);
				expect(policy.canEditMilestoneFirstScore()).toBe(id === 2 && evaluating);
				expect(policy.canEditMilestoneSecondScore()).toBe(id === 3 && evaluating);
				expect(policy.canEditCommonEvaluationFirst()).toBe(id === 2 && evaluating);
				expect(policy.canEditCommonEvaluationSecond()).toBe(id === 3 && evaluating);
				expect(policy.canEditOverallComment("first")).toBe(id === 2 && evaluating);
				expect(policy.canEditOverallComment("second")).toBe(id === 3 && evaluating);
				expect(policy.canDecideFinalEvaluationRank()).toBe(id === 3 && evaluating);
				expect(policy.canSubmitOwnSheet()).toBe(id === 1 && status === EvaluationStatus.DRAFT);
				expect(policy.canRevertOwnSheetToDraft()).toBe(id === 1 && evaluating);
				expect(policy.canFinalizeAsSecondaryEvaluator()).toBe(id === 3 && evaluating);
				expect(policy.canExportSheet()).toBe(id === 2 || id === 3);
				expect(policy.canExportSecondEvaluation()).toBe(id === 3);
			},
		);
	}
	it("fails closed when subject is incorrectly assigned as their own evaluator", () => {
		const invalid = EvaluationSheet.create({
			sheetId: 100,
			subject: new Employee(1, "テスト", "TEST001", 1, null, null, 1, 1),
			evaluationPeriod: period(),
			primaryEvaluatorName: "本人",
			secondaryEvaluatorName: "本人",
			objectives: [],
			status: EvaluationStatus.SUBMITTED,
		});
		const policy = EvaluationSheetAccessPolicy.for(1, invalid);
		expect(policy.canEditMilestoneFirstScore()).toBe(false);
		expect(policy.canEditMilestoneSecondScore()).toBe(false);
		expect(policy.canEditCommonEvaluationFirst()).toBe(false);
		expect(policy.canEditCommonEvaluationSecond()).toBe(false);
		expect(policy.canFinalizeAsSecondaryEvaluator()).toBe(false);
		expect(policy.canExportSecondEvaluation()).toBe(false);
	});
	it("mapper refuses unauthorized callers even outside fetch use case", () => {
		const data = sheet();
		expect(() =>
			toEvaluationSheetDto(data, "等級", EvaluationSheetAccessPolicy.for(4, data)),
		).toThrow("権限");
	});
});
