import { describe, expect, it } from "vitest";
import { reviewScore } from "../../adapter/viewmodels/reviewerWorkspace";
import { toSheetExportDataDto } from "../../application/dtos/ExportSheetMapper";
import {
	commonRepository,
	commonResult,
	employee,
	milestone,
	milestoneRepository,
	period,
	sheetRepository,
} from "../../test/fixtures";
import { reviewerRow } from "../../test/reviewerFixture";
import { CommonEvaluationItem } from "../entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../entities/CommonEvaluationResult";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { Milestone } from "../entities/Milestone";
import { EvaluationScoreUpdateService } from "../services/EvaluationScoreUpdateService";
import { createSheetWithCommonEvaluation } from "../services/EvaluationSheetDomainService";
import { EvaluationAllocatedScores } from "./EvaluationAllocatedScores";
import { EvaluationAllocation } from "./EvaluationAllocation";
import { EvaluationScoreTotals } from "./EvaluationScoreTotals";

const calculate = (scores: number[], allocation = EvaluationAllocation.DEFAULT) =>
	EvaluationAllocatedScores.fromTotals(
		EvaluationScoreTotals.fromObjectives(
			scores.map((score) => milestone().withScoreUpdates({ secondScore: score })),
		),
		EvaluationScoreTotals.fromCommonEvaluationResults([commonResult()]),
		false,
		allocation,
	);

describe("configurable allocation", () => {
	it.each([
		[0, 100],
		[20, 80],
		[31, 69],
		[100, 0],
	])("accepts %s / %s", (objective, common) => {
		expect(
			EvaluationAllocation.of(objective, common).equals(EvaluationAllocation.of(objective, common)),
		).toBe(true);
	});
	it.each([
		[50, 60],
		[-1, 101],
		[101, -1],
		[20.5, 79.5],
		[NaN, 80],
		[Infinity, 0],
	])("rejects %s / %s", (objective, common) => {
		expect(() => EvaluationAllocation.of(objective, common)).toThrow();
	});
	it.each([
		[[4], 20],
		[[4, 4], 20],
		[[2, 2], 10],
		[[3, 4], 18],
		[[], 0],
	])("uses actual goal count for %j", (scores, expected) => {
		expect(calculate(scores).objectiveEvaluationScore).toBe(expected);
	});
	it("multiplies the exact fraction before rounding even after restoring saved totals", () => {
		const allocation = EvaluationAllocation.of(31, 69);
		expect(calculate([2, 3], allocation).objectiveEvaluationScore).toBe(19);
		const restored = EvaluationScoreTotals.fromValues({
			secondTotalScore: 5,
			secondTotalRate: 63,
			maxTotalScore: 8,
		});
		expect(
			EvaluationAllocatedScores.fromTotals(
				restored,
				EvaluationScoreTotals.zero(),
				false,
				allocation,
			).objectiveEvaluationScore,
		).toBe(19);
	});
	it.each([1, 2, 9])("normalizes common evaluation with %s items of unequal weight", (count) => {
		// 配点は係数。どの項目も一次 2・二次 4(満点)で評価すれば、項目数や配点に関係なく 50% と 100%
		const results = Array.from({ length: count }, (_, i) =>
			CommonEvaluationResult.create({
				id: i,
				sheetId: 100,
				itemId: i,
				firstScore: 2,
				secondScore: 4,
				item: new CommonEvaluationItem(i, "項目", "説明", (i + 1) * 2, 1),
			}),
		);
		const totals = EvaluationScoreTotals.fromCommonEvaluationResults(results);
		expect(
			EvaluationAllocatedScores.fromTotals(
				EvaluationScoreTotals.zero(),
				totals,
				false,
				EvaluationAllocation.of(35, 65),
			).commonEvaluationEvaluationScore,
		).toBe(65);
		expect(
			EvaluationAllocatedScores.fromTotals(
				EvaluationScoreTotals.zero(),
				totals,
				true,
				EvaluationAllocation.of(35, 65),
			).commonEvaluationEvaluationScore,
		).toBe(33);
	});
	it("treats an item's weight as a coefficient: ten items of weight 1 are worth 40 points", () => {
		const ratings = (first: number[], weight = 1) =>
			EvaluationScoreTotals.fromCommonEvaluationResults(
				first.map((score, i) =>
					CommonEvaluationResult.create({
						id: i,
						sheetId: 100,
						itemId: i,
						firstScore: score,
						secondScore: 4,
						item: new CommonEvaluationItem(i, "項目", "説明", weight, 1),
					}),
				),
			);
		const allocated = (totals: EvaluationScoreTotals, primaryIsFinal: boolean) =>
			EvaluationAllocatedScores.fromTotals(EvaluationScoreTotals.zero(), totals, primaryIsFinal)
				.commonEvaluationEvaluationScore;
		// 配点 1 の項目を 4 と評価すれば 4 点。10 個すべて 4 なら 40 / 40 で、共通評価の配点 80 点を満額
		const ten = ratings([4, 4, 4, 3, 3, 3, 2, 2, 1, 0]);
		expect(ten).toMatchObject({ firstTotalScore: 26, firstTotalRate: 65, secondTotalScore: 40 });
		expect(allocated(ten, false)).toBe(80);
		// 26 / 40 × 80 = 52 点
		expect(allocated(ten, true)).toBe(52);
		// 項目数が違う等級(6 個)でも、得点率が同じなら評価点は同じ
		expect(allocated(ratings([4, 4, 2, 2, 2, 2]), false)).toBe(80);
		// 配点 3 の項目は、同じ評価でも 3 倍の重みを持つ: (3×4 + 1×0) / ((3+1)×4) = 75%
		const weighted = EvaluationScoreTotals.fromCommonEvaluationResults([
			CommonEvaluationResult.create({
				id: 1,
				sheetId: 100,
				itemId: 1,
				firstScore: 4,
				secondScore: 0,
				item: new CommonEvaluationItem(1, "重い項目", "説明", 3, 1),
			}),
			CommonEvaluationResult.create({
				id: 2,
				sheetId: 100,
				itemId: 2,
				firstScore: 0,
				secondScore: 0,
				item: new CommonEvaluationItem(2, "軽い項目", "説明", 1, 1),
			}),
		]);
		expect(weighted).toMatchObject({ firstTotalScore: 12, firstTotalRate: 75 });
		expect(allocated(weighted, true)).toBe(60);
	});
	it("does not divide by zero or award points to an empty category", () => {
		const totals = EvaluationScoreTotals.fromValues({
			secondTotalScore: 5,
			secondTotalRate: 100,
			maxTotalScore: 0,
		});
		expect(totals.scoreFor(80)).toBe(0);
		expect(calculate([4, 4], EvaluationAllocation.of(0, 100)).totalEvaluationScore).toBe(100);
	});
	it("matches the reviewer list for a nondefault allocation and fractional rate", () => {
		const allocation = EvaluationAllocation.of(31, 69);
		const row = reviewerRow();
		row.objectiveAllocation = 31;
		row.commonAllocation = 69;
		row.objectives = [2, 3].map((score, i) => ({
			...row.objectives[0],
			id: i,
			secondScore: score,
		}));
		row.commonItems = [{ ...row.commonItems[0], secondScore: 4 }];
		expect(reviewScore(row, "second")).toBe(calculate([2, 3], allocation).totalEvaluationScore);
		expect(reviewScore(row, "second")).toBe(88);
	});
	it("uses settings in goal updates, common updates, and sheet initialization", async () => {
		const allocation = EvaluationAllocation.of(35, 65);
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(
			EvaluationSheet.create({
				sheetId: 100,
				subject: employee(),
				evaluationPeriod: period(),
				primaryEvaluatorName: "一次",
				secondaryEvaluatorName: "二次",
				objectives: [milestone()],
				commonEvaluationResults: [commonResult()],
				allocation,
			}),
		);
		const common = commonRepository();
		const service = new EvaluationScoreUpdateService(sheets, milestoneRepository(), common);
		await service.updateObjectiveScore(11, undefined, 4);
		await service.refreshCommonEvaluationTotals(100);
		await createSheetWithCommonEvaluation(10, 1, [], sheets, common);
		for (const [, totals] of sheets.updateScoreTotals.mock.calls) {
			expect(totals.allocatedScores).toMatchObject({
				objectiveAllocationScore: 35,
				commonEvaluationAllocationScore: 65,
				totalEvaluationScore: 100,
			});
		}
		expect(sheets.updateScoreTotals).toHaveBeenCalledTimes(3);
	});
});
it("rounds an exact half point up even when dividing first would fall just short of it", () => {
	// 7 / 10 × 45 は 31.5 点。先に割ると 31.499999… になり 31 点に切り捨てられる
	expect(EvaluationAllocation.fromTotal(45, 7, 10)).toBe(32);
	expect(EvaluationAllocation.fromTotal(85, 14, 20)).toBe(60);
	expect(EvaluationAllocation.fromTotal(20, 7, 8)).toBe(18);
	expect(EvaluationAllocation.fromTotal(80, 5, 6)).toBe(67);
	expect(EvaluationAllocation.fromTotal(80, 3, 0)).toBe(0);
});

// Three/four goals must use 12/16 as the denominator throughout the calculation path.
it.each([
	{ scores: [1, 2, 4], allocation: 6, rate: 58, points: 4 },
	{ scores: [1, 2, 3, 4], allocation: 31, rate: 63, points: 19 },
])(
	"calculates both stages, reviewer totals, persistence and export for $scores",
	async ({ scores, allocation: objectiveAllocation, rate, points }) => {
		const allocation = EvaluationAllocation.of(objectiveAllocation, 100 - objectiveAllocation);
		const objectives = scores.map((score, index) =>
			Milestone.create({
				id: 11 + index,
				sheetId: 100,
				goalNumber: index + 1,
				challengeGoal: "目標",
				midtermGoal: "中間",
				achievement: "達成",
				firstScore: score,
				secondScore: score,
			}),
		);
		const totals = EvaluationScoreTotals.fromObjectives(objectives);
		const sum = scores.reduce((total, score) => total + score, 0);
		expect(totals).toMatchObject({
			firstTotalScore: sum,
			secondTotalScore: sum,
			firstTotalRate: rate,
			secondTotalRate: rate,
		});
		for (const primaryIsFinal of [false, true]) {
			expect(
				EvaluationAllocatedScores.fromTotals(
					totals,
					EvaluationScoreTotals.zero(),
					primaryIsFinal,
					allocation,
				).objectiveEvaluationScore,
			).toBe(points);
		}
		const current = EvaluationSheet.create({
			sheetId: 100,
			subject: employee(),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			objectives,
			commonEvaluationResults: [commonResult()],
			allocation,
		});
		const row = reviewerRow();
		row.objectiveAllocation = allocation.objective;
		row.commonAllocation = allocation.common;
		row.objectives = objectives.map((goal) => ({
			id: goal.id,
			goalNumber: goal.goalNumber,
			challengeGoal: goal.challengeGoal,
			achievement: goal.achievement,
			firstScore: goal.firstScore.toNumber(),
			secondScore: goal.secondScore.toNumber(),
		}));
		row.commonItems = [{ ...row.commonItems[0], firstScore: 3, secondScore: 4 }];
		expect(reviewScore(row, "first")).toBe(current.firstEvaluationScore());
		expect(reviewScore(row, "second")).toBe(current.allocatedScores.totalEvaluationScore);
		expect(current.allocatedScores.totalEvaluationScore).toBe(points + allocation.common);
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(current);
		const milestones = milestoneRepository();
		milestones.findBySheetId.mockResolvedValue(objectives);
		milestones.updateScore.mockResolvedValue(objectives[objectives.length - 1]);
		await new EvaluationScoreUpdateService(
			sheets,
			milestones,
			commonRepository(),
		).updateObjectiveScore(
			objectives[objectives.length - 1].id,
			undefined,
			scores[scores.length - 1],
		);
		expect(sheets.updateScoreTotals).toHaveBeenCalledWith(
			100,
			expect.objectContaining({
				objectives: expect.objectContaining({
					firstTotalScore: sum,
					secondTotalScore: sum,
					firstTotalRate: rate,
					secondTotalRate: rate,
				}),
				allocatedScores: expect.objectContaining({
					objectiveEvaluationScore: points,
					totalEvaluationScore: points + allocation.common,
				}),
			}),
		);
		const exported = toSheetExportDataDto(current, "等級");
		expect(exported.objectives).toHaveLength(scores.length);
		expect(exported.objectiveSecondRate).toBe(String(rate));
		expect(exported.objectiveEvaluationScore).toBe(String(points));
	},
);
it.each([3, 4])("awards the same full allocation with %s goals all rated four", (count) => {
	expect(calculate(Array(count).fill(4))).toMatchObject({
		objectiveSecondRate: 100,
		objectiveEvaluationScore: 20,
		totalEvaluationScore: 100,
	});
});

