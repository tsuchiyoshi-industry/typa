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
		EvaluationStatus.GOALS_SUBMITTED,
		EvaluationStatus.GOALS_CONFIRMED,
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
				// 一次評価は一次評価待ちの間だけ、二次評価は一次評価の確定後だけ
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
				expect(policy.canSubmitGoals()).toBe(id === 1 && draft);
				// 再送できるのは、いまの状態へシートを渡した人。要修正で戻した下書きは、評価者にはもう見えない
				expect(policy.canResendNotification()).toBe(
					(id === 1 && (firstStage || status.isGoalsSubmitted())) ||
						(id === 2 && (secondStage || status.isGoalsConfirmed())),
				);
				expect(policy.canReturnGoalsToDraft()).toBe(id === 2 && status.isGoalsSubmitted());
				expect(policy.canConfirmGoals()).toBe(id === 2 && status.isGoalsSubmitted());
				expect(policy.canRequestFirstEvaluation()).toBe(id === 1 && status.isGoalsConfirmed());
				// 達成状況は、目標が確定してから一次評価を依頼するまでの間だけ本人が書ける(下書き・確認中は書けない)
				expect(policy.canEditMilestoneAchievement()).toBe(id === 1 && status.isGoalsConfirmed());
				// 前期のチャレンジ目標を据え置く・見直すのは、目標を書ける下書きの間だけ
				expect(policy.canCarryOverGoal()).toBe(id === 1 && draft);
				expect(policy.canConfirmFirstEvaluation()).toBe(id === 2 && firstStage);
				expect(policy.canFinalizeEvaluation()).toBe(id === 3 && secondStage);
				// 出力できるのは評価が確定したシートだけ。本人も出力できる
				expect(policy.canExportSheet()).toBe(
					(id === 1 || evaluator) && status === EvaluationStatus.FINALIZED,
				);
			},
		);
	}
	it("offers no resend while the workspace notifies in the app", () => {
		for (const status of statuses) {
			for (const id of [1, 2, 3, 4]) {
				const inApp = sheet(status, undefined, false, false, false);
				expect(EvaluationSheetAccessPolicy.for(id, inApp).canResendNotification()).toBe(false);
			}
		}
	});
	it("freezes every change once the period is closed, and lets the evaluators read a closed draft", () => {
		for (const status of statuses) {
			for (const id of [1, 2, 3]) {
				const open = EvaluationSheetAccessPolicy.for(id, sheet(status));
				const closed = EvaluationSheetAccessPolicy.for(id, sheet(status, undefined, true));
				expect(closed.canEditMilestoneGoal()).toBe(false);
				expect(closed.canEditMilestoneAchievement()).toBe(false);
				expect(closed.canCarryOverGoal()).toBe(false);
				expect(closed.canEditMilestoneFirstScore()).toBe(false);
				expect(closed.canEditMilestoneSecondScore()).toBe(false);
				expect(closed.canEditCommonEvaluationFirst()).toBe(false);
				expect(closed.canEditCommonEvaluationSecond()).toBe(false);
				expect(closed.canEditOverallComment("first")).toBe(false);
				expect(closed.canEditOverallComment("second")).toBe(false);
				expect(closed.canSubmitGoals()).toBe(false);
				expect(closed.canReturnGoalsToDraft()).toBe(false);
				expect(closed.canConfirmFirstEvaluation()).toBe(false);
				expect(closed.canFinalizeEvaluation()).toBe(false);
				expect(closed.periodOpen()).toEqual({ ok: false, error: { kind: "periodClosed" } });
				expect(open.periodOpen().ok).toBe(true);
				// 締めた下書きはもう変わらないので、評価者も読める。ほかの見られる範囲は変わらない
				const closedDraftForEvaluator = status === EvaluationStatus.DRAFT && id !== 1;
				expect(closed.canViewSheet()).toBe(open.canViewSheet() || closedDraftForEvaluator);
				expect(closed.canViewCommonEvaluation()).toBe(
					open.canViewCommonEvaluation() || closedDraftForEvaluator,
				);
				expect(closed.canViewFinalEvaluation()).toBe(open.canViewFinalEvaluation());
				// 出力できるのは確定済みシートだけのまま
				expect(closed.canExportSheet()).toBe(open.canExportSheet());
			}
		}
	});
	it("exports unfinalized sheets only once a period that allows it has been closed", () => {
		for (const status of statuses) {
			for (const id of [1, 2, 3, 4]) {
				const loose = (closed: boolean) =>
					EvaluationSheetAccessPolicy.for(id, sheet(status, undefined, closed, true));
				// 関係者は全員出力できる。実施中の間は、これまでどおり確定したシートだけ
				expect(loose(true).canExportSheet()).toBe(id !== 4);
				expect(loose(false).canExportSheet()).toBe(
					status === EvaluationStatus.FINALIZED &&
						(id === 1 || (id !== 4 && status !== EvaluationStatus.DRAFT)),
				);
			}
		}
	});
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
				// 一次評価 (目標50% → 10点、共通75% → 60点) がそのまま最終評価になる
				expect(withoutSecondary.allocatedScores.totalEvaluationScore).toBe(70);
				if (id === 1 || (id === 2 && !draft)) {
					const dto = toEvaluationSheetDto(withoutSecondary, "等級", policy);
					expect(dto.allocatedScores.totalEvaluationScore).toBe(id === 2 ? 70 : null);
					// 評価ランクは評価者にだけ見せる。本人には渡さない
					expect(dto.finalEvaluationRank?.displayText).toBe(
						id === 2 && !status.isGoalsSubmitted() && !status.isGoalsConfirmed() ? "B" : undefined,
					);
					expect(dto.firstEvaluationRank?.displayText).toBe(
						id === 2 && !status.isGoalsSubmitted() && !status.isGoalsConfirmed() ? "B" : undefined,
					);
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
	});
	it("mapper refuses unauthorized callers even outside fetch use case", () => {
		const data = sheet();
		expect(() =>
			toEvaluationSheetDto(data, "等級", EvaluationSheetAccessPolicy.for(4, data)),
		).toThrow("権限");
	});
});
