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
	const period = new EvaluationPeriod(1, "2026年度上期", "2026-04-01", "2026-09-30", true);
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

		it("一次評価者は二次評価者のスコアを見られないが、本人と二次評価者は見られる", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canViewMilestoneSecondScore(),
			).toBe(false);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canViewMilestoneSecondScore()).toBe(
				true,
			);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canViewMilestoneSecondScore(),
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
			expect(can(SUBJECT_ID, EvaluationStatus.DRAFT).canSubmitOwnSheet()).toBe(true);
			expect(can(PRIMARY_EVALUATOR_ID, EvaluationStatus.DRAFT).canConfirmFirstEvaluation()).toBe(
				false,
			);
			expect(can(SECONDARY_EVALUATOR_ID, EvaluationStatus.DRAFT).canFinalizeEvaluation()).toBe(
				false,
			);
		});

		it("提出済みは本人が下書きに戻せ、一次評価者だけが一次評価を確定できる", () => {
			const status = EvaluationStatus.SUBMITTED;
			expect(can(SUBJECT_ID, status).canRevertOwnSheetToDraft()).toBe(true);
			expect(can(PRIMARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(true);
			expect(can(SECONDARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(false);
			expect(can(SUBJECT_ID, status).canConfirmFirstEvaluation()).toBe(false);
			// 一次評価が確定するまで、二次評価者は確定できない
			expect(can(SECONDARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(false);
		});

		it("一次評価済みは本人も一次評価者も戻せず、二次評価者だけが評価を確定できる", () => {
			const status = EvaluationStatus.FIRST_EVALUATED;
			expect(can(SUBJECT_ID, status).canRevertOwnSheetToDraft()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(false);
			expect(can(SECONDARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(true);
		});

		it("確定済みシートは誰も戻せず、再確定・再提出もできない", () => {
			const status = EvaluationStatus.FINALIZED;
			expect(can(SUBJECT_ID, status).canRevertOwnSheetToDraft()).toBe(false);
			expect(can(SUBJECT_ID, status).canSubmitOwnSheet()).toBe(false);
			expect(can(PRIMARY_EVALUATOR_ID, status).canConfirmFirstEvaluation()).toBe(false);
			expect(can(SECONDARY_EVALUATOR_ID, status).canFinalizeEvaluation()).toBe(false);
		});
	});

	describe("出力(PDFエクスポート)", () => {
		it("評価が確定するまでは、評価者も出力できない", () => {
			for (const status of [
				EvaluationStatus.DRAFT,
				EvaluationStatus.SUBMITTED,
				EvaluationStatus.FIRST_EVALUATED,
			]) {
				const sheet = buildSheet(status);
				expect(EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canExportSheet()).toBe(
					false,
				);
				expect(
					EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canExportSheet(),
				).toBe(false);
			}
		});

		it("被評価者と無関係者は出力できず、評価者のみ出力できる", () => {
			const sheet = buildSheet(EvaluationStatus.FINALIZED);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canExportSheet()).toBe(false);
			expect(EvaluationSheetAccessPolicy.for(UNRELATED_ID, sheet).canExportSheet()).toBe(false);
			expect(EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canExportSheet()).toBe(
				true,
			);
			expect(EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canExportSheet()).toBe(
				true,
			);
		});

		it("二次評価者のみ出力に二次評価の内容を含められる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canExportSecondEvaluation(),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canExportSecondEvaluation(),
			).toBe(true);
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
			const period = new EvaluationPeriod(1, "2026年度上期", "2026-04-01", "2026-09-30", true);
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
});
