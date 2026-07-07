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

		it("下書き中は評価者も閲覧のみで、スコアは編集できない", () => {
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
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canViewCommonEvaluation(),
			).toBe(true);
		});

		it("本人が提出した後、一次/二次評価者はそれぞれのスコアを編集できる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditMilestoneFirstScore(),
			).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
				).canEditMilestoneSecondScore(),
			).toBe(true);
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
		it("評価者のみ閲覧でき、本人は閲覧できない(下書き中でも閲覧は可能)", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
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

		it("本人が提出した後は評価者がスコアを編集できる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canEditCommonEvaluationFirst(),
			).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(
					SECONDARY_EVALUATOR_ID,
					sheet,
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

	describe("シートロック(提出・確定)", () => {
		it("本人は下書きを提出できるが、二次評価者はまだ確定できない", () => {
			const sheet = buildSheet(EvaluationStatus.DRAFT);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canChangeStatusTo(true)).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canChangeStatusTo(true),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canChangeStatusTo(true),
			).toBe(false);
		});

		it("提出済み(評価入力段階)は本人が下書きに戻せ、二次評価者は確定できる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canChangeStatusTo(false)).toBe(
				true,
			);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canChangeStatusTo(false),
			).toBe(false);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canChangeStatusTo(true),
			).toBe(true);
			expect(
				EvaluationSheetAccessPolicy.for(PRIMARY_EVALUATOR_ID, sheet).canChangeStatusTo(true),
			).toBe(false);
		});

		it("二次評価者が確定した後は、本人も下書きに戻せない", () => {
			const sheet = buildSheet(EvaluationStatus.FINALIZED);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canChangeStatusTo(false)).toBe(
				false,
			);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canRevertOwnSheetToDraft()).toBe(
				false,
			);
		});

		it("確定済みシートは誰も再確定・再提出できない", () => {
			const sheet = buildSheet(EvaluationStatus.FINALIZED);
			expect(EvaluationSheetAccessPolicy.for(SUBJECT_ID, sheet).canChangeStatusTo(true)).toBe(
				false,
			);
			expect(
				EvaluationSheetAccessPolicy.for(SECONDARY_EVALUATOR_ID, sheet).canChangeStatusTo(true),
			).toBe(false);
		});
	});

	describe("出力(PDFエクスポート)", () => {
		it("被評価者と無関係者は出力できず、評価者のみ出力できる", () => {
			const sheet = buildSheet(EvaluationStatus.SUBMITTED);
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
