import { describe, expect, it } from "vitest";
import { Employee } from "../../domain/entities/Employee";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { commonResult, milestone, period, sheet } from "../../test/fixtures";
import { toSheetExportDataDto } from "./ExportSheetMapper";

const finalized = () => sheet(EvaluationStatus.FINALIZED);

describe("PDF data built from the same sheet as the screen", () => {
	it("uses the sheet's scores, weights and rank instead of recalculating them", () => {
		const source = finalized();
		const data = toSheetExportDataDto(source, "等級");
		const scores = source.allocatedScores;
		expect(data).toMatchObject({
			sheetId: 100,
			employeeName: "テスト社員",
			gradeName: "等級",
			periodName: "テスト期間",
			status: "finalized",
			finalEvaluationRank: source.resolveFinalEvaluationRank().toDisplayText(),
			objectiveAllocationScore: scores.objectiveAllocationScore,
			objectiveSecondRate: String(scores.objectiveSecondRate),
			objectiveEvaluationScore: String(scores.objectiveEvaluationScore),
			commonEvaluationAllocationScore: scores.commonEvaluationAllocationScore,
			commonEvaluationSecondRate: String(scores.commonEvaluationSecondRate),
			commonEvaluationEvaluationScore: String(scores.commonEvaluationEvaluationScore),
			totalEvaluationScore: String(scores.totalEvaluationScore),
			firstOverallComment: "一次総評",
			secondOverallComment: "二次総評",
		});
		expect(data).not.toHaveProperty("totalScore");
		expect(data.objectives[0]).toMatchObject({ selfScore: 2, evaluatorScore: "4" });
		expect(data.commonEvaluations[0]).toMatchObject({
			itemName: "共通項目",
			weight: 5,
			selfScore: 3,
			evaluatorScore: "4",
			selfComment: "一次コメント",
			evaluatorComment: null,
		});
	});

	it("has no second-evaluation scores when the primary evaluator is the final evaluator", () => {
		const withoutSecondary = EvaluationSheet.create({
			sheetId: 100,
			subject: new Employee(1, "テスト社員", "TEST001", 1, null, 5, 2, null, true),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "なし",
			objectives: [milestone()],
			commonEvaluationResults: [commonResult()],
			status: EvaluationStatus.FINALIZED,
		});
		const data = toSheetExportDataDto(withoutSecondary, "等級");
		expect(data.primaryIsFinalEvaluator).toBe(true);
		expect(data.careerCourse).toBe("");
		expect(data.objectives[0].evaluatorScore).toBe("未評価");
		expect(data.commonEvaluations[0].evaluatorScore).toBe("未評価");
	});
});
