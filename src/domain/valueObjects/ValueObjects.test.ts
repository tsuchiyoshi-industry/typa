import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { blank, textBetween } from "../../test/arbitraries";
import { commonResult, employee, milestone, period } from "../../test/fixtures";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { Comment } from "./Comment";
import { EMPLOYEE_ROLE_NAMES, EmployeeRole } from "./EmployeeRole";
import { EvaluationAllocatedScores } from "./EvaluationAllocatedScores";
import { EvaluationRank } from "./EvaluationRank";
import { EvaluationScoreTotals } from "./EvaluationScoreTotals";
import { EVALUATION_STATUS_VALUES, EvaluationStatus } from "./EvaluationStatus";
import { Score } from "./Score";

describe("value objects and immutable entities", () => {
	it.each(["unknown", "", "SUBMITTED"])(
		"rejects unknown status %s instead of opening a draft",
		(value) => {
			expect(() => EvaluationStatus.from(value)).toThrow("Invalid evaluation status");
		},
	);
	it("validates rank even when runtime values bypass TypeScript", () => {
		expect(() => EvaluationRank.from("X", "none")).toThrow("Invalid evaluation rank");
	});
	// 小数を切り捨てて受け付けない(2.9 を 2 として保存しない)。数でない値(画面や API から来た "3")も断る
	it.prop(
		[
			fc.oneof(
				fc.integer({ max: -1 }),
				fc.integer({ min: Score.MAX + 1 }),
				fc.double().filter((value) => !Number.isInteger(value)),
				fc.anything().filter((value) => typeof value !== "number"),
			),
		],
		{ examples: [[Number.NaN], [Number.POSITIVE_INFINITY], [2.9], ["3"]] },
	)("rejects anything but an integer from 0 to 4", (value) => {
		expect(Score.isValid(value)).toBe(false);
		expect(() => Score.from(value as number)).toThrow("点数は 0〜4 の整数");
	});
	it.prop([fc.integer({ min: 0, max: Score.MAX })])("accepts an integer from 0 to 4", (value) => {
		expect(Score.isValid(value)).toBe(true);
		expect(Score.from(value).toNumber()).toBe(value);
	});
	it.each([undefined, null])("treats a missing score (%s) as unrated", (value) => {
		expect(Score.fromOptional(value).toNumber()).toBe(0);
	});
	it.prop([fc.constantFrom(null, undefined), blank])(
		"normalizes an empty or blank comment to empty",
		(missing, spaces) => {
			expect(Comment.from(missing).toString()).toBe("");
			expect(Comment.from(spaces).toString()).toBe("");
		},
	);
	it.prop([blank, textBetween(1, 80), blank])(
		"keeps a comment as written, without the spaces around it, and does so only once",
		(before, comment, after) => {
			const trimmed = Comment.from(`${before}${comment}${after}`);
			expect(trimmed.toString()).toBe(comment);
			expect(Comment.from(trimmed.toString())).toEqual(trimmed);
		},
	);
	it("keeps statuses to the known values in the order a sheet moves through them", () => {
		expect(EvaluationStatus.ALL.map(String)).toEqual([...EVALUATION_STATUS_VALUES]);
		expect(EvaluationStatus.ALL.map((status) => status.order())).toEqual([0, 1, 2, 3, 4, 5]);
		// 同じ値は同じインスタンス。比較は === でできる
		expect(EvaluationStatus.from("finalized")).toBe(EvaluationStatus.FINALIZED);
		expect(EvaluationStatus.find("first_evaluated")).toBe(EvaluationStatus.FIRST_EVALUATED);
		for (const unknown of ["missing", "", null, undefined]) {
			expect(EvaluationStatus.find(unknown)).toBeUndefined();
		}
	});
	it("trims comments without interpreting markup", () => {
		expect(Comment.from("  <script>x</script>  ").value).toBe("<script>x</script>");
	});
	it.each([...EVALUATION_STATUS_VALUES])("round trips status %s", (value) => {
		const status = EvaluationStatus.from(value);
		expect(status.toString()).toBe(value);
		expect(status.isDraft()).toBe(value === "draft");
		expect(status.isSentToEvaluators()).toBe(value !== "draft");
		// 採点は一次評価の依頼から。目標の確認中は点数もランクもまだ無い
		expect(status.isEvaluationStarted()).toBe(
			["submitted", "first_evaluated", "finalized"].includes(value),
		);
		expect(status.isAwaitingFirstEvaluation()).toBe(value === "submitted");
		expect(status.isAwaitingSecondEvaluation()).toBe(value === "first_evaluated");
		expect(status.isFirstEvaluationConfirmed()).toBe(
			value === "first_evaluated" || value === "finalized",
		);
		expect(status.isFinalized()).toBe(value === "finalized");
	});
	// 区切りの数字そのものは、末尾の bands() / describeThresholds() のテストで固定する
	const position = (rank: EvaluationRank) =>
		EvaluationRank.bands().findIndex((band) => band.rank.toDisplayText() === rank.toDisplayText());
	it.prop([fc.double({ min: 0, max: 100, noNaN: true })], {
		examples: [[95], [94.9], [80], [79.999], [40], [39.5], [0]],
	})("gives a rate the rank of the highest band it reaches", (rate) => {
		const reached = EvaluationRank.bands().filter((band) => rate >= band.minimum);
		expect(EvaluationRank.fromScoreRate(rate)).toEqual(reached[0].rank);
	});
	it.prop([
		fc.double({ min: 0, max: 100, noNaN: true }),
		fc.double({ min: 0, max: 100, noNaN: true }),
	])("never ranks a higher score rate below a lower one", (a, b) => {
		const [low, high] = a <= b ? [a, b] : [b, a];
		expect(position(EvaluationRank.fromScoreRate(high))).toBeLessThanOrEqual(
			position(EvaluationRank.fromScoreRate(low)),
		);
	});
	it.prop([fc.nat(400), fc.integer({ min: 1, max: 400 }), fc.integer({ min: 2, max: 50 })], {
		examples: [
			[19, 20, 2],
			[58, 100, 3],
		],
	})("rates a score against the full score, whatever the scale", (score, full, times) => {
		expect(EvaluationRank.fromScore(score * times, full * times)).toEqual(
			EvaluationRank.fromScore(score, full),
		);
		expect(EvaluationRank.fromScore(full, full).toDisplayText()).toBe("S");
	});
	it.prop([fc.nat(), fc.integer({ max: 0 })])("treats no full score as zero", (score, full) => {
		expect(EvaluationRank.fromScore(score, full).toDisplayText()).toBe("D");
	});
	it("round trips ranks through display text", () => {
		for (const text of ["S", "A", "B+", "B", "B-", "C", "D"]) {
			expect(EvaluationRank.fromText(text)?.toDisplayText()).toBe(text);
		}
		expect(EvaluationRank.from("S", "plus").toDisplayText()).toBe("S+");
		expect(EvaluationRank.fromOptional("A", "none")?.toDisplayText()).toBe("A");
		expect(EvaluationRank.fromOptional()).toBeUndefined();
		expect(EvaluationRank.fromText(null)).toBeUndefined();
		expect(EvaluationRank.fromText("")).toBeUndefined();
		for (const text of ["Z", "E", "F-"]) {
			expect(() => EvaluationRank.fromText(text)).toThrow();
		}
	});
	it.each([
		["X", "none"],
		["A", "bad"],
		// 得点率から決まるのは S〜D だけ。E・F は使わない
		["E", "none"],
		["F", "minus"],
	])("rejects rank %s/%s", (letter, level) =>
		expect(() => EvaluationRank.fromOptional(letter, level)).toThrow(),
	);
	it("uses the stored rank only for a confirmed stage, otherwise the rank of the current score", () => {
		// フィクスチャの保存値は A+。一次評価 70点 → B、二次評価 100点 → S
		const stored = (status: EvaluationStatus) =>
			EvaluationSheet.create({
				sheetId: 100,
				subject: employee(),
				evaluationPeriod: period(),
				primaryEvaluatorName: "一次",
				secondaryEvaluatorName: "二次",
				objectives: [milestone()],
				commonEvaluationResults: [commonResult()],
				status,
				firstEvaluationRank: EvaluationRank.from("A", "none"),
				finalEvaluationRank: EvaluationRank.from("A", "plus"),
			});
		const submitted = stored(EvaluationStatus.SUBMITTED);
		expect(submitted.firstEvaluationScore()).toBe(70);
		expect(submitted.resolveFirstEvaluationRank().toDisplayText()).toBe("B");
		expect(submitted.resolveFinalEvaluationRank().toDisplayText()).toBe("S");
		const firstEvaluated = stored(EvaluationStatus.FIRST_EVALUATED);
		expect(firstEvaluated.resolveFirstEvaluationRank().toDisplayText()).toBe("A");
		expect(firstEvaluated.resolveFinalEvaluationRank().toDisplayText()).toBe("S");
		const finalized = stored(EvaluationStatus.FINALIZED);
		expect(finalized.resolveFirstEvaluationRank().toDisplayText()).toBe("A");
		expect(finalized.resolveFinalEvaluationRank().toDisplayText()).toBe("A+");
	});
	it("calculates rates using objective maximum and common item weights", () => {
		expect(EvaluationScoreTotals.fromObjectives([milestone()])).toMatchObject({
			firstTotalScore: 2,
			firstTotalRate: 50,
			secondTotalScore: 4,
			secondTotalRate: 100,
		});
		// 配点は係数。配点 5 の項目を 3 と 4 で評価すると、得点は 15 と 20、満点は 5 × 4 = 20
		expect(EvaluationScoreTotals.fromCommonEvaluationResults([commonResult()])).toMatchObject({
			firstTotalScore: 15,
			firstTotalRate: 75,
			secondTotalScore: 20,
			secondTotalRate: 100,
		});
		expect(
			EvaluationAllocatedScores.fromTotals(
				EvaluationScoreTotals.fromObjectives([milestone()]),
				EvaluationScoreTotals.fromCommonEvaluationResults([commonResult()]),
			),
		).toMatchObject({
			objectiveEvaluationScore: 20,
			commonEvaluationEvaluationScore: 80,
			totalEvaluationScore: 100,
		});
	});
	it("uses the primary evaluation in full when the primary is the final evaluator", () => {
		const objectives = EvaluationScoreTotals.fromObjectives([milestone()]);
		const common = EvaluationScoreTotals.fromCommonEvaluationResults([commonResult()]);
		// 一次評価: 目標 2/4 = 50% → 20点中10点、共通 15/20 = 75% → 80点中60点
		expect(EvaluationAllocatedScores.fromTotals(objectives, common, true)).toMatchObject({
			objectiveSecondRate: 50,
			objectiveEvaluationScore: 10,
			commonEvaluationSecondRate: 75,
			commonEvaluationEvaluationScore: 60,
			totalEvaluationScore: 70,
		});
	});
	it("handles empty totals without dividing by zero", () => {
		expect(EvaluationScoreTotals.fromObjectives([])).toEqual(EvaluationScoreTotals.fromValues({}));
		expect(EvaluationScoreTotals.fromCommonEvaluationResults([])).toEqual(
			EvaluationScoreTotals.fromValues({}),
		);
		expect(EvaluationAllocatedScores.fromValues({}).totalEvaluationScore).toBe(0);
	});
	const weighted = fc.array(
		fc.record({
			weight: fc.integer({ min: 1, max: 20 }),
			firstScore: fc.integer({ min: 0, max: Score.MAX }),
			secondScore: fc.integer({ min: 0, max: Score.MAX }),
		}),
		{ maxLength: 30 },
	);
	it.prop([weighted])("adds weight × score and keeps the rate between 0 and 100", (items) => {
		const totals = EvaluationScoreTotals.fromWeightedScores(items);
		const sum = (score: (item: (typeof items)[number]) => number) =>
			items.reduce((total, item) => total + item.weight * score(item), 0);
		expect(totals.firstTotalScore).toBe(sum((item) => item.firstScore));
		expect(totals.secondTotalScore).toBe(sum((item) => item.secondScore));
		for (const rate of [totals.firstTotalRate, totals.secondTotalRate]) {
			expect(Number.isInteger(rate) && rate >= 0 && rate <= 100).toBe(true);
		}
	});
	it.prop([weighted.filter((items) => items.length > 0)])(
		"rates full marks as 100% and no marks as 0%, whatever the weights",
		(items) => {
			const full = EvaluationScoreTotals.fromWeightedScores(
				items.map((item) => ({ ...item, firstScore: Score.MAX, secondScore: 0 })),
			);
			expect([full.firstTotalRate, full.secondTotalRate]).toEqual([100, 0]);
		},
	);
	// 保存値の読み込み。欠けた値・負の値・無限・NaN は 0、小数は四捨五入する
	it.prop([fc.oneof(fc.double(), fc.integer(), fc.constantFrom(null, undefined))], {
		examples: [[Number.NaN], [Number.POSITIVE_INFINITY], [-1], [null], [undefined], [1.6]],
	})("normalizes a stored total to a non-negative integer", (value) => {
		const restored = EvaluationScoreTotals.fromValues({ firstTotalScore: value }).firstTotalScore;
		expect(Number.isInteger(restored) && restored >= 0).toBe(true);
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			expect(restored).toBe(Math.round(value));
		} else {
			expect(restored).toBe(0);
		}
	});
	it.each([NaN, Infinity, -1, null, undefined])("normalizes stored totals %s", (value) => {
		expect(
			EvaluationScoreTotals.fromValues({
				firstTotalScore: value,
				firstTotalRate: value,
				secondTotalScore: value,
				secondTotalRate: value,
			}),
		).toEqual(EvaluationScoreTotals.fromValues({}));
		expect(
			EvaluationAllocatedScores.fromValues({
				objectiveSecondRate: value,
				commonEvaluationSecondRate: value,
				objectiveEvaluationScore: value,
				commonEvaluationEvaluationScore: value,
				totalEvaluationScore: value,
			}).totalEvaluationScore,
		).toBe(0);
	});
	it("rounds allocation and respects persisted totals", () => {
		expect(EvaluationScoreTotals.fromValues({ firstTotalScore: 1.6 }).firstTotalScore).toBe(2);
		expect(
			EvaluationAllocatedScores.fromValues({
				objectiveSecondRate: 33,
				commonEvaluationSecondRate: 67,
			}).totalEvaluationScore,
		).toBe(61);
		expect(
			EvaluationAllocatedScores.fromValues({
				objectiveEvaluationScore: 10,
				commonEvaluationEvaluationScore: 40,
				totalEvaluationScore: 49,
			}).totalEvaluationScore,
		).toBe(49);
	});
	it("changes a milestone's text without touching the original or its scores", () => {
		const original = milestone();
		const changed = original.withTextUpdates({
			challengeGoal: "new",
			periodGoals: [{ description: "task", achievement: "達成" }],
		});
		expect(changed.ok && [changed.value.firstScore.value, changed.value.secondScore.value]).toEqual(
			[2, 4],
		);
		expect(original.challengeGoal).toBe("目標");
	});
	it("trims a common result's comment", () => {
		expect(commonResult({ firstComment: " x " }).firstComment.value).toBe("x");
	});
	it("keeps roles to the known values and treats an unknown stored name as the weakest role", () => {
		expect(EmployeeRole.ALL.map(String)).toEqual([...EMPLOYEE_ROLE_NAMES]);
		expect(EmployeeRole.find("Admin")).toBe(EmployeeRole.ADMIN);
		expect(EmployeeRole.find("admin")).toBeUndefined();
		for (const stored of ["Owner", "", null, undefined]) {
			expect(EmployeeRole.fromStored(stored)).toBe(EmployeeRole.EMPLOYEE);
		}
		expect(EmployeeRole.ALL.filter((role) => role.isAdmin())).toEqual([EmployeeRole.ADMIN]);
		expect(EmployeeRole.fromStored("Reviewer")).toBe(EmployeeRole.REVIEWER);
	});
});

it("describes the rank thresholds from the same table that decides the rank", () => {
	expect(EvaluationRank.describeThresholds()).toBe(
		"95%以上 S / 90% A / 80% B+ / 60% B / 50% B- / 40% C / それ未満 D",
	);
});

it("lists the rank bands from the top, each starting where its rank begins", () => {
	const bands = EvaluationRank.bands();
	expect(bands.map(({ minimum, rank }) => `${minimum} ${rank.toDisplayText()}`)).toEqual([
		"95 S",
		"90 A",
		"80 B+",
		"60 B",
		"50 B-",
		"40 C",
		"0 D",
	]);
	for (const { minimum, rank } of bands) {
		expect(EvaluationRank.fromScoreRate(minimum)).toEqual(rank);
	}
});
