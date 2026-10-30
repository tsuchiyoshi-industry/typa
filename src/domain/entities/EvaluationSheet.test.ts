import { describe, expect, it } from "vitest";
import { commonResult, employee, milestone, period, sheet } from "../../test/fixtures";
import { EvaluationAllocation } from "../valueObjects/EvaluationAllocation";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { EvaluationSheet, type StoredSheetScores } from "./EvaluationSheet";
import { Milestone } from "./Milestone";
import { describeSheetTransitionError, type SheetTransitionError } from "./SheetTransitionError";

// いまの点数: 目標 一次 2・二次 4、共通評価 一次 15/20・二次 20/20。保存値はわざと食い違わせる
const stale: StoredSheetScores = {
	objectivesFirstTotalScore: 1,
	objectivesFirstTotalRate: 10,
	objectivesSecondTotalScore: 1,
	objectivesSecondTotalRate: 10,
	commonEvaluationFirstTotalScore: 28,
	commonEvaluationFirstTotalRate: 280,
	commonEvaluationSecondTotalScore: 2,
	commonEvaluationSecondTotalRate: 10,
	objectivesSecondEvaluationScore: 3,
	commonEvaluationSecondEvaluationScore: 7,
	totalEvaluationScore: 10,
	objectiveAllocation: 40,
	commonAllocation: 60,
};

const restore = (
	status: EvaluationStatus,
	stored: StoredSheetScores,
	allocation?: EvaluationAllocation,
) =>
	EvaluationSheet.restore({
		sheetId: 100,
		subject: employee(),
		evaluationPeriod: period(),
		primaryEvaluatorName: "一次",
		secondaryEvaluatorName: "二次",
		objectives: [milestone()],
		commonEvaluationResults: [commonResult()],
		status,
		stored,
		allocation,
	});

describe("allocation of a stored sheet", () => {
	it("keeps the weights used at finalization", () => {
		expect(EvaluationSheet.storedAllocation(EvaluationStatus.FINALIZED, stale)).toEqual(
			EvaluationAllocation.of(40, 60),
		);
	});
	it.each([EvaluationStatus.DRAFT, EvaluationStatus.SUBMITTED, EvaluationStatus.FIRST_EVALUATED])(
		"uses current settings before finalization (%s)",
		(status) => {
			expect(EvaluationSheet.storedAllocation(status, stale)).toBeUndefined();
		},
	);
	it("uses current settings when a finalized sheet has no stored weights", () => {
		expect(
			EvaluationSheet.storedAllocation(EvaluationStatus.FINALIZED, {
				...stale,
				commonAllocation: null,
			}),
		).toBeUndefined();
	});
});

describe("restoring stored totals", () => {
	it("keeps the stored totals and scores of a finalized sheet", () => {
		const sheet = restore(EvaluationStatus.FINALIZED, stale, EvaluationAllocation.of(40, 60));
		expect(sheet.objectiveScoreTotals).toMatchObject({ firstTotalScore: 1, secondTotalRate: 10 });
		expect(sheet.commonEvaluationScoreTotals).toMatchObject({ firstTotalRate: 280 });
		expect(sheet.allocatedScores).toMatchObject({
			objectiveAllocationScore: 40,
			objectiveEvaluationScore: 3,
			commonEvaluationEvaluationScore: 7,
			totalEvaluationScore: 10,
		});
	});

	it.each([EvaluationStatus.DRAFT, EvaluationStatus.SUBMITTED, EvaluationStatus.FIRST_EVALUATED])(
		"recalculates an open sheet from the actual scores (%s)",
		(status) => {
			const allocation = EvaluationAllocation.of(20, 80);
			const restored = restore(status, stale, allocation);
			const fresh = EvaluationSheet.create({
				sheetId: 100,
				subject: employee(),
				evaluationPeriod: period(),
				primaryEvaluatorName: "一次",
				secondaryEvaluatorName: "二次",
				objectives: [milestone()],
				commonEvaluationResults: [commonResult()],
				status,
				allocation,
			});
			expect(restored.objectiveScoreTotals).toEqual(fresh.objectiveScoreTotals);
			expect(restored.commonEvaluationScoreTotals).toEqual(fresh.commonEvaluationScoreTotals);
			expect(restored.allocatedScores).toEqual(fresh.allocatedScores);
			expect(restored.commonEvaluationScoreTotals.firstTotalRate).toBe(75);
		},
	);

	it("derives scores from the stored rates when a finalized sheet has no stored scores", () => {
		const sheet = restore(
			EvaluationStatus.FINALIZED,
			{
				...stale,
				objectivesSecondEvaluationScore: null,
				commonEvaluationSecondEvaluationScore: null,
				totalEvaluationScore: null,
			},
			EvaluationAllocation.of(40, 60),
		);
		// 獲得率 10% × 配点 40 = 4、10% × 60 = 6
		expect(sheet.allocatedScores).toMatchObject({
			objectiveEvaluationScore: 4,
			commonEvaluationEvaluationScore: 6,
			totalEvaluationScore: 10,
		});
	});
});

describe("what a sheet needs before it moves on", () => {
	const draft = (
		objectives = [milestone()],
		status = EvaluationStatus.DRAFT,
		common = commonResult({ firstScore: 0, secondScore: 0 }),
	) =>
		EvaluationSheet.create({
			sheetId: 100,
			subject: employee(),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			objectives,
			commonEvaluationResults: [common],
			status,
		});
	const blank = Milestone.restore({ id: 12, sheetId: 100, goalNumber: 2, challengeGoal: "  " });
	const failure = (result: { ok: boolean; error?: SheetTransitionError }) =>
		result.ok ? null : result.error;

	it("lets a sheet go back to draft whatever it holds", () => {
		expect(
			draft([blank], EvaluationStatus.GOALS_SUBMITTED).readinessFor(EvaluationStatus.DRAFT),
		).toEqual({ ok: true, value: undefined });
	});

	it.each([
		EvaluationStatus.GOALS_SUBMITTED,
		EvaluationStatus.GOALS_CONFIRMED,
		EvaluationStatus.SUBMITTED,
	])("needs every challenge goal written before %s, and names the blank ones", (status) => {
		const incomplete = failure(draft([milestone(), blank]).readinessFor(status));
		expect(incomplete).toEqual({
			kind: "objectivesIncomplete",
			missing: ["目標 2：チャレンジ目標"],
		});
		expect(incomplete && describeSheetTransitionError(incomplete)).toBe(
			"チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。\n・目標 2：チャレンジ目標",
		);
		expect(failure(draft([]).readinessFor(status))).toEqual({
			kind: "objectivesIncomplete",
			missing: ["チャレンジ目標は1〜4件必要です。"],
		});
		expect(draft().readinessFor(status).ok).toBe(true);
	});

	it.each([
		[4, 4, true],
		[5, 4, false],
		[2, 2, true],
		[3, 2, false],
	])("allows %s goals under a limit of %s: %s", (count, max, allowed) => {
		const goals = Array.from({ length: count }, (_, i) =>
			Milestone.restore({ id: 20 + i, sheetId: 100, goalNumber: i + 1, challengeGoal: "目標" }),
		);
		const sheet = EvaluationSheet.create({ ...draft(goals), maxObjectives: max });
		expect(failure(sheet.readinessFor(EvaluationStatus.GOALS_SUBMITTED))).toEqual(
			allowed
				? null
				: { kind: "objectivesIncomplete", missing: [`チャレンジ目標は1〜${max}件必要です。`] },
		);
	});

	it("needs the confirming evaluator's own scores, and only those, before confirming", () => {
		// 一次 2・二次 4 の目標と、未評価の共通評価
		const first = failure(draft().readinessFor(EvaluationStatus.FIRST_EVALUATED));
		expect(first).toEqual({
			kind: "evaluationIncomplete",
			stage: "first",
			pending: ["共通評価「共通項目」"],
		});
		expect(first && describeSheetTransitionError(first)).toBe(
			"一次評価に未設定の項目が 1 件あります。すべての評価を 1〜4 で設定して保存してください。\n・共通評価「共通項目」",
		);
		expect(failure(draft().readinessFor(EvaluationStatus.FINALIZED))).toMatchObject({
			kind: "evaluationIncomplete",
			stage: "second",
		});
		const scored = draft(
			[milestone()],
			EvaluationStatus.SUBMITTED,
			commonResult({ firstScore: 3, secondScore: 0 }),
		);
		expect(scored.readinessFor(EvaluationStatus.FIRST_EVALUATED).ok).toBe(true);
	});
});

describe("changing the status of a copy", () => {
	const returned = (status = EvaluationStatus.DRAFT) =>
		EvaluationSheet.create({
			sheetId: 100,
			subject: employee(),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			objectives: [milestone()],
			status,
			goalReturnReason: "数値目標を入れてください",
		});

	it("changes only the status, leaving the original as it was", () => {
		const before = sheet(EvaluationStatus.GOALS_SUBMITTED);
		const after = before.withStatus(EvaluationStatus.DRAFT);
		expect([before.status, after.status]).toEqual([
			EvaluationStatus.GOALS_SUBMITTED,
			EvaluationStatus.DRAFT,
		]);
		const { status: _after, ...rest } = after;
		const { status: _before, ...original } = before;
		expect(rest).toEqual(original);
	});

	it("keeps the return reason while the sheet stays a draft", () => {
		expect(returned().withStatus(EvaluationStatus.DRAFT).goalReturnReason).toBe(
			"数値目標を入れてください",
		);
	});

	// DB も下書きを離れると理由を消す(evaluation_sheets_settle_goal_return_reason)
	it.each(EvaluationStatus.ALL.filter((status) => !status.isDraft()))(
		"drops the return reason once the sheet leaves the draft for %s",
		(status) => {
			const moved = returned().withStatus(status);
			expect([moved.status, moved.goalReturnReason]).toEqual([status, ""]);
		},
	);
});
