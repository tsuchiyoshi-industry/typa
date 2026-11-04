import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { toSheetExportDataDto } from "../../application/dtos/ExportSheetMapper";
import { commonResult, employee, milestone, period } from "../../test/fixtures";
import { reviewerRow } from "../../test/reviewerFixture";
import { CommonEvaluationItem } from "../entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../entities/CommonEvaluationResult";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { Milestone } from "../entities/Milestone";
import { reviewScore } from "../entities/ReviewerWorkspace";
import { EvaluationSheetAccessPolicy } from "../services/EvaluationSheetAccessPolicy";
import { EvaluationAllocatedScores } from "./EvaluationAllocatedScores";
import { EvaluationAllocation } from "./EvaluationAllocation";
import { EvaluationScoreTotals } from "./EvaluationScoreTotals";

const calculate = (scores: number[], allocation = EvaluationAllocation.DEFAULT) =>
	EvaluationAllocatedScores.fromTotals(
		EvaluationScoreTotals.fromObjectives(scores.map((score) => milestone({ secondScore: score }))),
		EvaluationScoreTotals.fromCommonEvaluationResults([commonResult()]),
		false,
		allocation,
	);

describe("configurable allocation", () => {
	it.prop([fc.integer({ min: 0, max: 100 })], { examples: [[0], [31], [100]] })(
		"accepts any split of 100 points into whole numbers",
		(objective) => {
			expect(EvaluationAllocation.of(objective, 100 - objective)).toMatchObject({
				objective,
				common: 100 - objective,
			});
		},
	);
	const anyNumber = fc.oneof(fc.integer({ min: -200, max: 200 }), fc.double());
	it.prop([anyNumber, anyNumber], {
		examples: [
			[50, 60],
			[-1, 101],
			[101, -1],
			[20.5, 79.5],
			[Number.NaN, 80],
			[Number.POSITIVE_INFINITY, 0],
		],
	})("rejects anything else", (objective, common) => {
		fc.pre(
			!(
				Number.isInteger(objective) &&
				Number.isInteger(common) &&
				objective >= 0 &&
				common >= 0 &&
				objective + common === 100
			),
		);
		expect(() => EvaluationAllocation.of(objective, common)).toThrow();
	});
	// 目標の数で割る。目標が 1 つでも 4 つでも、すべて 4 なら配点を満額
	it.prop([fc.integer({ min: 0, max: 4 }), fc.integer({ min: 1, max: 8 })], {
		examples: [
			[4, 1],
			[4, 3],
			[4, 4],
			[2, 2],
		],
	})("uses the actual goal count", (score, count) => {
		expect(calculate(Array(count).fill(score)).objectiveEvaluationScore).toBe(
			Math.round((20 * score) / 4),
		);
	});
	it("awards nothing for no goals", () => {
		expect(calculate([]).objectiveEvaluationScore).toBe(0);
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
				EvaluationScoreTotals.fromValues({}),
				false,
				allocation,
			).objectiveEvaluationScore,
		).toBe(19);
	});
	// 配点は係数。どの項目も一次 2・二次 4(満点)で評価すれば、項目数や配点に関係なく 50% と 100%
	it.prop([fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 12 })], {
		examples: [[[2]], [[2, 4]], [[2, 4, 6, 8, 10, 12, 14, 16, 18]]],
	})("normalizes common evaluation whatever the number and weights of items", (weights) => {
		const results = weights.map((weight, i) =>
			CommonEvaluationResult.create({
				id: i,
				sheetId: 100,
				itemId: i,
				firstScore: 2,
				secondScore: 4,
				item: new CommonEvaluationItem(i, "項目", "説明", weight, 1),
			}),
		);
		const totals = EvaluationScoreTotals.fromCommonEvaluationResults(results);
		expect(
			EvaluationAllocatedScores.fromTotals(
				EvaluationScoreTotals.fromValues({}),
				totals,
				false,
				EvaluationAllocation.of(35, 65),
			).commonEvaluationEvaluationScore,
		).toBe(65);
		expect(
			EvaluationAllocatedScores.fromTotals(
				EvaluationScoreTotals.fromValues({}),
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
			EvaluationAllocatedScores.fromTotals(
				EvaluationScoreTotals.fromValues({}),
				totals,
				primaryIsFinal,
			).commonEvaluationEvaluationScore;
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
	it("uses the configured allocation for a sheet's scores", () => {
		const allocation = EvaluationAllocation.of(35, 65);
		const saved = EvaluationSheet.create({
			sheetId: 100,
			subject: employee(),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			objectives: [milestone()],
			commonEvaluationResults: [commonResult()],
			allocation,
		});
		expect(saved.allocatedScores).toMatchObject({
			objectiveAllocationScore: 35,
			commonEvaluationAllocationScore: 65,
			totalEvaluationScore: 100,
		});
	});
});
// 7 / 10 × 45 は 31.5 点。先に割ると 31.499999… になり 31 点に切り捨てられる。
// 小数を使わず、整数だけで「r が score × allocation / maximum の四捨五入(0.5 は切り上げ)か」を確かめる
it.prop(
	[
		fc.integer({ min: 0, max: 100 }),
		fc
			.integer({ min: 1, max: 400 })
			.chain((max) => fc.tuple(fc.integer({ min: 0, max }), fc.constant(max))),
	],
	{
		examples: [
			[45, [7, 10]],
			[85, [14, 20]],
			[20, [7, 8]],
			[80, [5, 6]],
		],
	},
)(
	"rounds to the nearest point, an exact half up, without falling short",
	(allocation, [score, maximum]) => {
		const points = EvaluationAllocation.fromTotal(allocation, score, maximum);
		const twice = 2 * score * allocation;
		expect(twice).toBeGreaterThanOrEqual((2 * points - 1) * maximum);
		expect(twice).toBeLessThan((2 * points + 1) * maximum);
		expect(points).toBeLessThanOrEqual(allocation);
	},
);

it.prop([fc.integer({ min: 0, max: 100 }), fc.nat()])(
	"awards nothing when there is no full score",
	(allocation, score) => {
		expect(EvaluationAllocation.fromTotal(allocation, score, 0)).toBe(0);
	},
);

// 目標の数(3 つなら 12、4 つなら 16 が満点)を、計算のどの経路でも分母に使う。
// シート・部下の一覧・保存値・PDF が同じ点数になる
it.prop(
	[
		fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 6 }),
		fc.integer({ min: 0, max: 100 }),
	],
	{
		examples: [
			[[1, 2, 4], 6],
			[[1, 2, 3, 4], 31],
		],
	},
)(
	"calculates both stages, reviewer totals, persistence and export the same way",
	(scores, objectiveAllocation) => {
		const allocation = EvaluationAllocation.of(objectiveAllocation, 100 - objectiveAllocation);
		const maximum = scores.length * 4;
		const rate = Math.round((scores.reduce((total, score) => total + score, 0) / maximum) * 100);
		const points = EvaluationAllocation.fromTotal(
			objectiveAllocation,
			scores.reduce((total, score) => total + score, 0),
			maximum,
		);
		const objectives = scores.map((score, index) =>
			Milestone.restore({
				id: 11 + index,
				sheetId: 100,
				goalNumber: index + 1,
				challengeGoal: "目標",
				periodGoals: [{ description: "手順を見直す", achievement: "達成" }],
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
					EvaluationScoreTotals.fromValues({}),
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
			periodGoals: goal.periodGoals,
			achievement: goal.achievement,
			firstScore: goal.firstScore.toNumber(),
			secondScore: goal.secondScore.toNumber(),
		}));
		row.commonItems = [{ ...row.commonItems[0], firstScore: 3, secondScore: 4 }];
		expect(reviewScore(row, "first")).toBe(current.firstEvaluationScore());
		expect(reviewScore(row, "second")).toBe(current.allocatedScores.totalEvaluationScore);
		expect(current.allocatedScores.totalEvaluationScore).toBe(points + allocation.common);
		expect(current.objectiveScoreTotals).toMatchObject({
			firstTotalScore: sum,
			secondTotalScore: sum,
			firstTotalRate: rate,
			secondTotalRate: rate,
		});
		expect(current.allocatedScores).toMatchObject({
			objectiveEvaluationScore: points,
			totalEvaluationScore: points + allocation.common,
		});
		const exported = toSheetExportDataDto(
			current,
			"等級",
			EvaluationSheetAccessPolicy.for(3, current),
		);
		expect(exported.objectives).toHaveLength(scores.length);
		expect(exported.objectiveSecondRate).toBe(String(rate));
		expect(exported.objectiveEvaluationScore).toBe(String(points));
	},
);
it.prop([fc.integer({ min: 1, max: 8 })], { examples: [[3], [4]] })(
	"awards the same full allocation however many goals are all rated four",
	(count) => {
		expect(calculate(Array(count).fill(4))).toMatchObject({
			objectiveSecondRate: 100,
			objectiveEvaluationScore: 20,
			totalEvaluationScore: 100,
		});
	},
);
