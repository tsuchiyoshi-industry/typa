import { describe, expect, it } from "vitest";
import { Employee } from "../entities/Employee";
import { EvaluationPeriod } from "../entities/EvaluationPeriod";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { EvaluationSheetAccessPolicy } from "./EvaluationSheetAccessPolicy";

const SUBJECT_ID = 1;
const PRIMARY_EVALUATOR_ID = 2;
const SECONDARY_EVALUATOR_ID = 3;
const UNRELATED_ID = 4;

function buildSheet(status: EvaluationStatus): EvaluationSheet {
	const subject = new Employee(
		SUBJECT_ID,
		"本人",
		"E001",
		1,
		null,
		null,
		PRIMARY_EVALUATOR_ID,
		SECONDARY_EVALUATOR_ID,
	);
	const period = EvaluationPeriod.restore({
		id: 1,
		termName: "2026年度",
		division: "half",
		part: 1,
		startDate: "2026-04-01",
		endDate: "2026-09-30",
		isActive: true,
	});
	return EvaluationSheet.create({
		sheetId: 100,
		subject,
		evaluationPeriod: period,
		primaryEvaluatorName: "一次評価者",
		secondaryEvaluatorName: "二次評価者",
		objectives: [],
		status,
	});
}

describe("EvaluationSheetAccessPolicy", () => {
	// 役割 × 状態ごとの編集・状態の変更・出力・見られる範囲は AccessPolicyMatrix.test.ts が全組み合わせを確かめる。
	// ここでは、その表に載らない立場(兼務・異動・Admin)を確かめる。
	describe("本人であり、かつ別シートの評価者でもあるケース", () => {
		it("役割はシートごとに独立して解決される", () => {
			const ownSheet = buildSheet(EvaluationStatus.DRAFT);

			const subordinateSubject = new Employee(
				UNRELATED_ID,
				"部下",
				"E999",
				1,
				null,
				null,
				SUBJECT_ID,
				null,
			);
			const period = EvaluationPeriod.restore({
				id: 1,
				termName: "2026年度",
				division: "half",
				part: 1,
				startDate: "2026-04-01",
				endDate: "2026-09-30",
				isActive: true,
			});
			const subordinateSheet = EvaluationSheet.create({
				sheetId: 200,
				subject: subordinateSubject,
				evaluationPeriod: period,
				primaryEvaluatorName: "自分",
				secondaryEvaluatorName: "未設定",
				objectives: [],
				status: EvaluationStatus.SUBMITTED,
			});

			const onOwnSheet = EvaluationSheetAccessPolicy.for(SUBJECT_ID, ownSheet);
			const onSubordinateSheet = EvaluationSheetAccessPolicy.for(SUBJECT_ID, subordinateSheet);

			expect(onOwnSheet.canEditMilestoneGoal()).toBe(true);
			expect(onOwnSheet.canEditMilestoneFirstScore()).toBe(false);

			expect(onSubordinateSheet.canEditMilestoneGoal()).toBe(false);
			expect(onSubordinateSheet.canEditMilestoneFirstScore()).toBe(true);
		});
	});

	describe("異動で新しく評価者になった人(社員マスタの今の評価者)", () => {
		const NEW_EVALUATOR_ID = 5;
		const policyFor = (status: EvaluationStatus, viewer = NEW_EVALUATOR_ID) => {
			const sheet = buildSheet(status);
			return EvaluationSheetAccessPolicy.for(
				viewer,
				EvaluationSheet.create({ ...sheet, currentEvaluatorIds: [NEW_EVALUATOR_ID, SUBJECT_ID] }),
			);
		};

		it("確定したシートは、帳票と同じ全体を読んで出力できるが、何も変えられない", () => {
			const policy = policyFor(EvaluationStatus.FINALIZED);
			expect(policy.canViewSheet()).toBe(true);
			expect(policy.canViewMilestoneSecondScore()).toBe(true);
			expect(policy.canViewCommonEvaluation()).toBe(true);
			expect(policy.canViewCommonEvaluationSecond()).toBe(true);
			expect(policy.canViewFinalEvaluation()).toBe(true);
			expect(policy.canExportSheet()).toBe(true);
			expect(policy.canEditMilestoneFirstScore()).toBe(false);
			expect(policy.canEditMilestoneSecondScore()).toBe(false);
			expect(policy.canFinalizeEvaluation()).toBe(false);
			expect(policy.canResendNotification()).toBe(false);
		});

		it("確定前のシートは、シートの評価者でなければ読めない", () => {
			for (const status of [
				EvaluationStatus.DRAFT,
				EvaluationStatus.SUBMITTED,
				EvaluationStatus.FIRST_EVALUATED,
			]) {
				expect(policyFor(status).canViewSheet()).toBe(false);
			}
		});

		it("本人が自分の評価者として残っていても、本人として扱う", () => {
			const policy = policyFor(EvaluationStatus.FINALIZED, SUBJECT_ID);
			expect(policy.canViewCommonEvaluation()).toBe(false);
			expect(policy.canViewFinalEvaluation()).toBe(false);
		});
	});

	describe("Admin(全社のシートを見られる人)", () => {
		const ADMIN_ID = UNRELATED_ID;
		const asAdmin = (status: EvaluationStatus, viewer = ADMIN_ID) =>
			EvaluationSheetAccessPolicy.for(viewer, buildSheet(status), true);

		it.each(EvaluationStatus.ALL)(
			"関わらないシートは、%s でも全体を読めるが、何も変えられない",
			(status) => {
				const policy = asAdmin(status);
				expect(policy.canViewSheet()).toBe(true);
				expect(policy.viewsAsAdmin()).toBe(true);
				expect(policy.canViewMilestoneFirstScore()).toBe(true);
				expect(policy.canViewMilestoneSecondScore()).toBe(true);
				expect(policy.canViewCommonEvaluation()).toBe(true);
				expect(policy.canViewCommonEvaluationSecond()).toBe(true);
				expect(policy.canViewFinalEvaluation()).toBe(true);
				for (const can of [
					policy.canEditMilestoneGoal(),
					policy.canEditMilestoneAchievement(),
					policy.canEditMilestoneFirstScore(),
					policy.canEditMilestoneSecondScore(),
					policy.canEditCommonEvaluationFirst(),
					policy.canEditCommonEvaluationSecond(),
					policy.canCarryOverGoal(),
					policy.canSubmitGoals(),
					policy.canReturnGoalsToDraft(),
					policy.canConfirmGoals(),
					policy.canRequestFirstEvaluation(),
					policy.canConfirmFirstEvaluation(),
					policy.canFinalizeEvaluation(),
					policy.canResendNotification(),
				]) {
					expect(can).toBe(false);
				}
			},
		);

		it("PDF の出力は権限ではなくシートの状態で決まる(確定したシートだけ)", () => {
			expect(asAdmin(EvaluationStatus.FIRST_EVALUATED).canExportSheet()).toBe(false);
			expect(asAdmin(EvaluationStatus.FINALIZED).canExportSheet()).toBe(true);
		});

		it("自分が本人のシートは本人として見る(確定前の点数・共通評価は見えない)", () => {
			const policy = asAdmin(EvaluationStatus.FIRST_EVALUATED, SUBJECT_ID);
			expect(policy.viewsAsAdmin()).toBe(false);
			expect(policy.canViewMilestoneFirstScore()).toBe(false);
			expect(policy.canViewCommonEvaluation()).toBe(false);
			expect(policy.canViewFinalEvaluation()).toBe(false);
		});

		it("自分が一次評価者のシートは一次評価者として見る(二次評価は見えず、下書きも開けない)", () => {
			const policy = asAdmin(EvaluationStatus.FIRST_EVALUATED, PRIMARY_EVALUATOR_ID);
			expect(policy.viewsAsAdmin()).toBe(false);
			expect(policy.canViewMilestoneSecondScore()).toBe(false);
			expect(policy.canViewCommonEvaluationSecond()).toBe(false);
			expect(asAdmin(EvaluationStatus.DRAFT, PRIMARY_EVALUATOR_ID).canViewSheet()).toBe(false);
		});

		it("Admin でなければ、関わらないシートは見られない", () => {
			const policy = EvaluationSheetAccessPolicy.for(
				UNRELATED_ID,
				buildSheet(EvaluationStatus.FINALIZED),
			);
			expect(policy.canViewSheet()).toBe(false);
			expect(policy.viewsAsAdmin()).toBe(false);
		});
	});
});
