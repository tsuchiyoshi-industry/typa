import { describe, expect, it } from "vitest";
import { toEvaluationSheetDto } from "../../application/dtos/EvaluationSheetMapper";
import { commonResult, milestone, period, sheet } from "../../test/fixtures";
import { Employee } from "../entities/Employee";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { EmployeeRole } from "../valueObjects/EmployeeRole";
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
				// 出力できるのは評価が確定したシートだけ。本人も出力できる
				expect(policy.canExportSheet()).toBe(
					(id === 1 || evaluator) && status === EvaluationStatus.FINALIZED,
				);
			},
		);
	}
	for (const status of statuses) {
		it(`lets an Admin outside the evaluation read everything in ${status.toString()}, and change nothing`, () => {
			const data = sheet(status);
			// 4 は本人でも評価者でもない。権限が Admin のときだけ、閲覧できるようになる
			const policy = EvaluationSheetAccessPolicy.for(4, data, EmployeeRole.ADMIN);
			expect(policy.isViewingAsAdmin()).toBe(true);
			// 下書きも含めて、内容をすべて見られる
			expect(policy.canViewSheet()).toBe(true);
			expect(policy.canViewCommonEvaluation()).toBe(true);
			expect(policy.canViewCommonEvaluationSecond()).toBe(true);
			expect(policy.canViewMilestoneSecondScore()).toBe(true);
			expect(policy.canViewFinalEvaluation()).toBe(true);
			expect(policy.canExportSheet()).toBe(status === EvaluationStatus.FINALIZED);
			const dto = toEvaluationSheetDto(data, "等級", policy);
			expect(dto).toMatchObject({
				firstOverallComment: "一次総評",
				secondOverallComment: "二次総評",
				objectives: [{ firstScore: 2, secondScore: 4 }],
				allocatedScores: { totalEvaluationScore: data.allocatedScores.totalEvaluationScore },
			});
			expect(dto.finalEvaluationRank).toBeDefined();
			// 確定する立場ではないので、未評価の項目の案内は付かない
			expect(dto.pendingEvaluationItems).toBeUndefined();

			// 見られるだけで、記入・評価・提出・確定はどれもできない
			expect(policy.canEditMilestoneGoal()).toBe(false);
			expect(policy.canEditMilestoneFirstScore()).toBe(false);
			expect(policy.canEditMilestoneSecondScore()).toBe(false);
			expect(policy.canEditCommonEvaluationFirst()).toBe(false);
			expect(policy.canEditCommonEvaluationSecond()).toBe(false);
			expect(policy.canEditOverallComment("first")).toBe(false);
			expect(policy.canEditOverallComment("second")).toBe(false);
			expect(policy.canSubmitOwnSheet()).toBe(false);
			expect(policy.canRevertOwnSheetToDraft()).toBe(false);
			expect(policy.canConfirmFirstEvaluation()).toBe(false);
			expect(policy.canFinalizeEvaluation()).toBe(false);
		});
	}
	it.each([EmployeeRole.REVIEWER, EmployeeRole.EMPLOYEE, undefined])(
		"gives %s no access to a sheet they have no part in",
		(role) => {
			const policy = EvaluationSheetAccessPolicy.for(4, sheet(EvaluationStatus.FINALIZED), role);
			expect(policy.isViewingAsAdmin()).toBe(false);
			expect(policy.canViewSheet()).toBe(false);
			expect(policy.canViewCommonEvaluation()).toBe(false);
			expect(policy.canExportSheet()).toBe(false);
		},
	);
	it("treats an Admin as the subject on their own sheet: no early look at their own evaluation", () => {
		const policy = EvaluationSheetAccessPolicy.for(
			1,
			sheet(EvaluationStatus.FIRST_EVALUATED),
			EmployeeRole.ADMIN,
		);
		expect(policy.isViewingAsAdmin()).toBe(false);
		expect(policy.canViewSheet()).toBe(true);
		expect(policy.canViewCommonEvaluation()).toBe(false);
		expect(policy.canViewFinalEvaluation()).toBe(false);
	});
	it("keeps an Admin's own evaluator duties and adds the rest as reading only", () => {
		// 一次評価者(2)が Admin。一次評価は入力・確定でき、二次評価は見られるが確定はできない
		const first = EvaluationSheetAccessPolicy.for(
			2,
			sheet(EvaluationStatus.SUBMITTED),
			EmployeeRole.ADMIN,
		);
		expect(first.isViewingAsAdmin()).toBe(false);
		expect(first.canEditCommonEvaluationFirst()).toBe(true);
		expect(first.canConfirmFirstEvaluation()).toBe(true);
		const second = EvaluationSheetAccessPolicy.for(
			2,
			sheet(EvaluationStatus.FIRST_EVALUATED),
			EmployeeRole.ADMIN,
		);
		expect(second.canViewCommonEvaluationSecond()).toBe(true);
		expect(second.canViewFinalEvaluation()).toBe(true);
		expect(second.canEditCommonEvaluationSecond()).toBe(false);
		expect(second.canFinalizeEvaluation()).toBe(false);
		// 下書きは評価者には見せないが、Admin としては見られる
		expect(
			EvaluationSheetAccessPolicy.for(
				2,
				sheet(EvaluationStatus.DRAFT),
				EmployeeRole.ADMIN,
			).canViewSheet(),
		).toBe(true);
	});
	it("freezes every change once the period is closed, and keeps viewing and export", () => {
		for (const status of statuses) {
			for (const id of [1, 2, 3]) {
				const open = EvaluationSheetAccessPolicy.for(id, sheet(status));
				const closed = EvaluationSheetAccessPolicy.for(id, sheet(status, undefined, true));
				expect(closed.canEditMilestoneGoal()).toBe(false);
				expect(closed.canEditMilestoneFirstScore()).toBe(false);
				expect(closed.canEditMilestoneSecondScore()).toBe(false);
				expect(closed.canEditCommonEvaluationFirst()).toBe(false);
				expect(closed.canEditCommonEvaluationSecond()).toBe(false);
				expect(closed.canEditOverallComment("first")).toBe(false);
				expect(closed.canEditOverallComment("second")).toBe(false);
				expect(closed.canSubmitOwnSheet()).toBe(false);
				expect(closed.canRevertOwnSheetToDraft()).toBe(false);
				expect(closed.canConfirmFirstEvaluation()).toBe(false);
				expect(closed.canFinalizeEvaluation()).toBe(false);
				expect(() => closed.assertPeriodOpen()).toThrow("この評価期間は締められているため");
				expect(() => open.assertPeriodOpen()).not.toThrow();
				// 見られる範囲と、確定済みシートの出力は変わらない
				expect(closed.canViewSheet()).toBe(open.canViewSheet());
				expect(closed.canViewCommonEvaluation()).toBe(open.canViewCommonEvaluation());
				expect(closed.canViewFinalEvaluation()).toBe(open.canViewFinalEvaluation());
				expect(closed.canExportSheet()).toBe(open.canExportSheet());
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
					expect(dto.finalEvaluationRank?.displayText).toBe(id === 2 ? "B" : undefined);
					expect(dto.firstEvaluationRank?.displayText).toBe(id === 2 ? "B" : undefined);
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
