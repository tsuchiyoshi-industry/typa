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
	describe("チャレンジ目標(Milestone)", () => {
		it("本人のみ目標文言を編集できる", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canEditMilestoneGoal()).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditMilestoneGoal(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canEditMilestoneGoal(),
			).toBe(false);
		});

		it("下書き中は評価者に見せず、スコアも編集できない", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditMilestoneFirstScore(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canEditMilestoneSecondScore(),
			).toBe(false);
			expect(EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canViewSheet()).toBe(
				false,
			);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canViewCommonEvaluation(),
			).toBe(false);
		});

		it("提出後は一次評価者が、一次評価の確定後は二次評価者がスコアを編集できる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditMilestoneFirstScore(),
			).toBe(true);
			// 一次評価が確定するまで、二次評価者は入力できない
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canEditMilestoneSecondScore(),
			).toBe(false);
			const firstEvaluated = buildSheet(EvaluationStatus.FIRST_EVALUATED);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					firstEvaluated,
				).canEditMilestoneSecondScore(),
			).toBe(true);
			// 確定した一次評価は、一次評価者も変更できない
			expect(
				EvaluationSheetAccessPolicy.for(
					PRIMARY_EVALUATOR_ID,
					firstEvaluated,
				).canEditMilestoneFirstScore(),
			).toBe(false);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canEditMilestoneFirstScore()).toBe(
				false,
			);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canEditMilestoneSecondScore()).toBe(
				false,
			);
		});

		it("一次評価者は二次評価者のスコアを見られないが、二次評価者は見られる", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canViewMilestoneSecondScore(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canViewMilestoneSecondScore(),
			).toBe(true);
		});

		it("本人は評価が確定するまで、保存されただけの一次・二次評価のスコアを見られない", () => {
			for (const status of [
				EvaluationStatus.DRAFT,
				EvaluationStatus.SUBMITTED,
				EvaluationStatus.FIRST_EVALUATED,
			]) {
				const subject = EvaluationSheetAccessPolicy.for(SUBJECT_ID, buildSheet(status));
				expect(subject.canViewMilestoneFirstScore(), status.toString()).toBe(false);
				expect(subject.canViewMilestoneSecondScore(), status.toString()).toBe(false);
			}
			const finalized = EvaluationSheetAccessPolicy.for(
				SUBJECT_ID,
				buildSheet(EvaluationStatus.FINALIZED),
			);
			expect(finalized.canViewMilestoneFirstScore()).toBe(true);
			expect(finalized.canViewMilestoneSecondScore()).toBe(true);
			// 評価者は自分の段階で一次評価を見られる
			expect(
				EvaluationSheetAccessPolicy.for(
					PRIMARY_EVALUATOR_ID,
					buildSheet(EvaluationStatus.SUBMITTED),
				).canViewMilestoneFirstScore(),
			).toBe(true);
		});
	});

	describe("共通評価(CommonEvaluation)", () => {
		it("提出後は評価者のみ閲覧でき、本人は閲覧できない", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canViewCommonEvaluation(),
			).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canViewCommonEvaluation(),
			).toBe(true);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canViewCommonEvaluation()).toBe(
				false,
			);
			expect(EvaluationSheetAccessPolicy.for(UNRELATED_ID, sheet).canViewCommonEvaluation()).toBe(
				false,
			);
		});

		it("下書き中は評価者もスコアを編集できない", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditCommonEvaluationFirst(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canEditCommonEvaluationSecond(),
			).toBe(false);
		});

		it("提出後は一次評価者が、一次評価の確定後は二次評価者がスコアを編集できる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditCommonEvaluationFirst(),
			).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canEditCommonEvaluationSecond(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					buildSheet(EvaluationStatus.FIRST_EVALUATED),
				).canEditCommonEvaluationSecond(),
			).toBe(true);
		});

		it("一次評価者は二次評価の内容を見られない", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(
				EvaluationSheetAccessPolicy.for(
					PRIMARY_EVALUATOR_ID,
					sheet,
				).canViewCommonEvaluationSecond(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canViewCommonEvaluationSecond(),
			).toBe(true);
		});
	});

	describe("シートロック(提出・一次評価の確定・評価の確定)", () => {
		const can = (id: number, status: EvaluationStatus) =>
			EvaluationSheetAccessPolicy.for(id, buildSheet(status));

		it("本人は下書きを提出できるが、評価者はまだ何も確定できない", () => {
			expect(can(SUBJECT_ID, EvaluationStatus.DRAFT).canSubmitGoals()).toBe(true);
			expect(can(PRIMARY_EVALUATOR_ID, EvaluationStatus.DRAFT).canConfirmFirstEvaluation()).toBe(
				false,
			);
			expect(can(SECONDARY_EVALUATOR_ID, EvaluationStatus.DRAFT).canFinalizeEvaluation()).toBe(
				false,
			);
		});

		it("一次評価待ちは本人が下書きに戻せず、一次評価者だけが一次評価を確定できる", () => {
			const status = EvaluationStatus.SUBMITTED;
			expect(can(SUBJECT_ID, status).canReturnGoalsToDraft()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(true);
			expect(can(SECONDARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(false);
			expect(can(SUBJECT_ID, status).canConfirmFirstEvaluation()).toBe(false);
			// 一次評価が確定するまで、二次評価者は確定できない
			expect(can(SECONDARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(false);
		});

		it("一次評価済みは本人も一次評価者も戻せず、二次評価者だけが評価を確定できる", () => {
			const status = EvaluationStatus.FIRST_EVALUATED;
			expect(can(SUBJECT_ID, status).canReturnGoalsToDraft()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(false);
			expect(can(SECONDARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(true);
		});

		it("確定済みシートは誰も戻せず、再確定・再提出もできない", () => {
			const status = EvaluationStatus.FINALIZED;
			expect(can(SUBJECT_ID, status).canReturnGoalsToDraft()).toBe(false);
			expect(can(SUBJECT_ID, status).canSubmitGoals()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(false);
			expect(can(SECONDARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(false);
		});
	});

	describe("出力(PDFエクスポート)", () => {
		it("評価が確定するまでは、本人も評価者も出力できない", () => {
			for (const status of [
				EvaluationStatus.DRAFT,
				EvaluationStatus.SUBMITTED,
				EvaluationStatus.FIRST_EVALUATED,
			]) {
				const sheet = buildSheet(status);
				expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canExportSheet()).toBe(false);
				expect(EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canExportSheet()).toBe(
					false,
				);
				expect(
					EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canExportSheet(),
				).toBe(false);
			}
		});

		it("確定後は本人と評価者が出力でき、無関係者は出力できない", () => {
			const sheet = buildSheet(EvaluationStatus.FINALIZED);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canExportSheet()).toBe(true);
			expect(EvaluationSheetAccessPolicy.for(UNRELATED_ID, sheet).canExportSheet()).toBe(false);
			expect(EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canExportSheet()).toBe(
				true,
			);
			expect(EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canExportSheet()).toBe(
				true,
			);
		});
	});

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
});
