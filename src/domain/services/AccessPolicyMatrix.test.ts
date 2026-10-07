import { describe, expect, it } from "vitest";
import { toEvaluationSheetDto } from "../../application/dtos/EvaluationSheetMapper";
import { commonResult, milestone, period, sheet } from "../../test/fixtures";
import { Employee } from "../entities/Employee";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { EvaluationSheetAccessPolicy } from "./EvaluationSheetAccessPolicy";

describe("authorization matrix", () => {
	const statuses = [
		EvaluationStatus.DRAFT,
		EvaluationStatus.SUBMITTED,
		EvaluationStatus.FIRST_EVALUATED,
		EvaluationStatus.FINALIZED,
	];
	for (const status of statuses) {
		it.each([1, 2, 3, 4, null])(
			`enforces every permission in ${status.toString()} for %s`,
			(id) => {
				const policy = EvaluationSheetAccessPolicy.for(id, sheet(status));
				const draft = status === EvaluationStatus.DRAFT;
				// 一次評価は提出済みの間だけ、二次評価は一次評価の確定後だけ
				const firstStage = status === EvaluationStatus.SUBMITTED;
				const secondStage = status === EvaluationStatus.FIRST_EVALUATED;
				// 下書きは評価者に見せない
				const evaluator = (id === 2 || id === 3) && !draft;
				expect(policy.canViewSheet()).toBe(id === 1 || evaluator);
				expect(policy.canViewCommonEvaluation()).toBe(evaluator);
				expect(policy.canEditMilestoneGoal()).toBe(id === 1 && draft);
				expect(policy.canEditMilestoneFirstScore()).toBe(id === 2 && firstStage);
				expect(policy.canEditMilestoneSecondScore()).toBe(id === 3 && secondStage);
				expect(policy.canEditCommonEvaluationFirst()).toBe(id === 2 && firstStage);
				expect(policy.canEditCommonEvaluationSecond()).toBe(id === 3 && secondStage);
				expect(policy.canEditOverallComment("first")).toBe(id === 2 && firstStage);
				expect(policy.canEditOverallComment("second")).toBe(id === 3 && secondStage);
				expect(policy.canSubmitOwnSheet()).toBe(id === 1 && draft);
				expect(policy.canRevertOwnSheetToDraft()).toBe(id === 1 && firstStage);
				expect(policy.canConfirmFirstEvaluation()).toBe(id === 2 && firstStage);
				expect(policy.canFinalizeEvaluation()).toBe(id === 3 && secondStage);
				// 出力できるのは評価が確定したシートだけ
				expect(policy.canExportSheet()).toBe(evaluator && status === EvaluationStatus.FINALIZED);
				expect(policy.canExportSecondEvaluation()).toBe(id === 3);
			},
		);
	}
	for (const status of statuses) {
		it.each([1, 2, 3, null])(
			`with secondary explicitly set to none, the primary is the final evaluator in ${status.toString()} for %s`,
			(id) => {
				const withoutSecondary = EvaluationSheet.create({
					sheetId: 100,
					subject: new Employee(1, "テスト", "TEST001", 1, null, null, 2, null, true),
					evaluationPeriod: period(),
					primaryEvaluatorName: "一次",
					secondaryEvaluatorName: "なし",
					objectives: [milestone()],
					commonEvaluationResults: [commonResult()],
					status,
				});
				const policy = EvaluationSheetAccessPolicy.for(id, withoutSecondary);
				const draft = status === EvaluationStatus.DRAFT;
				const evaluating = status === EvaluationStatus.SUBMITTED;
				expect(policy.canViewSheet()).toBe(id === 1 || (id === 2 && !draft));
				expect(policy.canEditCommonEvaluationFirst()).toBe(id === 2 && evaluating);
				// 二次評価は誰も入力しない
				expect(policy.canEditMilestoneSecondScore()).toBe(false);
				expect(policy.canEditCommonEvaluationSecond()).toBe(false);
				expect(policy.canEditOverallComment("second")).toBe(false);
				// 一次評価の確定がそのまま評価の確定になる。「一次評価済み」は、
				// 一次評価の確定後に二次評価者を「なし」へ変えたシートを確定できるようにするための経路
				expect(policy.canConfirmFirstEvaluation()).toBe(false);
				expect(policy.canFinalizeEvaluation()).toBe(
					id === 2 && (evaluating || status === EvaluationStatus.FIRST_EVALUATED),
				);
				expect(policy.canExportSecondEvaluation()).toBe(id === 2);
				// 一次評価 (目標50% → 10点、共通60% → 48点) がそのまま最終評価になる
				expect(withoutSecondary.allocatedScores.totalEvaluationScore).toBe(58);
				if (id === 1 || (id === 2 && !draft)) {
					const dto = toEvaluationSheetDto(withoutSecondary, "等級", policy);
					expect(dto.allocatedScores.totalEvaluationScore).toBe(id === 2 ? 58 : null);
					// 評価ランクは評価者にだけ見せる。本人には渡さない
					expect(dto.finalEvaluationRank?.displayText).toBe(id === 2 ? "B-" : undefined);
					expect(dto.firstEvaluationRank?.displayText).toBe(id === 2 ? "B-" : undefined);
				}
			},
		);
	}
	it("a merely unset secondary evaluator does not promote the primary evaluator", () => {
		const pending = EvaluationSheet.create({
			sheetId: 100,
			subject: new Employee(1, "テスト", "TEST001", 1, null, null, 2, null),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "未設定",
			objectives: [milestone()],
			commonEvaluationResults: [commonResult()],
			status: EvaluationStatus.SUBMITTED,
		});
		const policy = EvaluationSheetAccessPolicy.for(2, pending);
		expect(policy.canEditCommonEvaluationFirst()).toBe(true);
		// 一次評価は確定できるが、最終評価者がいないので評価は確定できない
		expect(policy.canConfirmFirstEvaluation()).toBe(true);
		expect(policy.canFinalizeEvaluation()).toBe(false);
		expect(policy.canExportSecondEvaluation()).toBe(false);
		// 最終評価は二次評価のまま(milestone/commonResult の二次評価は満点)
		expect(pending.allocatedScores.totalEvaluationScore).toBe(100);
	});
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
		expect(policy.canFinalizeEvaluation()).toBe(false);
		expect(policy.canExportSecondEvaluation()).toBe(false);
	});
	it("mapper refuses unauthorized callers even outside fetch use case", () => {
		const data = sheet();
		expect(() =>
			toEvaluationSheetDto(data, "等級", EvaluationSheetAccessPolicy.for(4, data)),
		).toThrow("権限");
	});
});
