import { describe, expect, it } from "vitest";
import { commonResult, employee, milestone, period, profile, sheet } from "../../test/fixtures";
import { Comment } from "./Comment";
import { EvaluationAllocatedScores } from "./EvaluationAllocatedScores";
import { EvaluationScoreTotals } from "./EvaluationScoreTotals";
import { EvaluationStatus } from "./EvaluationStatus";
import { FinalEvaluationRank } from "./FinalEvaluationRank";
import { Score } from "./Score";

describe("value objects and immutable entities", () => {
	it.each(["unknown", "", "SUBMITTED"])(
		"rejects unknown status %s instead of opening a draft",
		(value) => {
			expect(() => EvaluationStatus.from(value)).toThrow("Invalid evaluation status");
		},
	);
	it("validates rank even when runtime values bypass TypeScript", () => {
		expect(() => FinalEvaluationRank.from("X" as "A", "none")).toThrow(
			"Invalid final evaluation rank",
		);
	});
	it.each([NaN, Infinity, -Infinity, -1])("rejects invalid score %s", (value) =>
		expect(() => Score.from(value)).toThrow(),
	);
	it("normalizes optional scores and compares values", () => {
		expect(Score.fromOptional().toNumber()).toBe(0);
		expect(Score.fromOptional(null).equals(Score.from(0))).toBe(true);
		expect(Score.from(2.9).toNumber()).toBe(2);
		expect(Score.from(2).equals(Score.from(3))).toBe(false);
	});
	it.each([null, undefined, "", "   "])("normalizes empty comment %s", (value) =>
		expect(Comment.from(value).toString()).toBe(""),
	);
	it("trims comments without interpreting markup", () => {
		expect(Comment.from("  <script>x</script>  ").value).toBe("<script>x</script>");
		expect(Comment.from(" x ").equals(Comment.from("x"))).toBe(true);
	});
	it.each(["draft", "submitted", "finalized"])("round trips status %s", (value) => {
		const status = EvaluationStatus.from(value);
		expect(status.toString()).toBe(value);
		expect(status.isDraft()).toBe(value === "draft");
		expect(status.isSubmitted()).toBe(value !== "draft");
		expect(status.isUnderEvaluation()).toBe(value === "submitted");
		expect(status.isFinalizedBySecondEvaluator()).toBe(value === "finalized");
		expect(status.equals(EvaluationStatus.from(value))).toBe(true);
	});
	it("enumerates all 21 ranks with display symbols", () => {
		expect(FinalEvaluationRank.options()).toHaveLength(21);
		expect(FinalEvaluationRank.from("S", "plus").toDisplayText()).toBe("S＋");
		expect(FinalEvaluationRank.from("F", "minus").toDisplayText()).toBe("F－");
		expect(FinalEvaluationRank.fromOptional("A", "none")?.toDisplayText()).toBe("A");
		expect(FinalEvaluationRank.fromOptional()).toBeUndefined();
	});
	it.each([
		["X", "none"],
		["A", "bad"],
	])("rejects rank %s/%s", (letter, level) =>
		expect(() => FinalEvaluationRank.fromOptional(letter, level)).toThrow(),
	);
	it("calculates rates using objective maximum and common item weights", () => {
		expect(EvaluationScoreTotals.fromObjectives([milestone()])).toMatchObject({
			firstTotalScore: 2,
			firstTotalRate: 50,
			secondTotalScore: 4,
			secondTotalRate: 100,
		});
		expect(EvaluationScoreTotals.fromCommonEvaluationResults([commonResult()])).toMatchObject({
			firstTotalScore: 3,
			firstTotalRate: 60,
			secondTotalScore: 5,
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
		// 一次評価: 目標 2/4 = 50% → 20点中10点、共通 3/5 = 60% → 80点中48点
		expect(EvaluationAllocatedScores.fromTotals(objectives, common, true)).toMatchObject({
			objectiveSecondRate: 50,
			objectiveEvaluationScore: 10,
			commonEvaluationSecondRate: 60,
			commonEvaluationEvaluationScore: 48,
			totalEvaluationScore: 58,
		});
		expect(objectives.withFirstAsFinal()).toMatchObject({
			firstTotalScore: 2,
			secondTotalScore: 2,
			secondTotalRate: 50,
		});
	});
	it("handles empty totals without dividing by zero", () => {
		expect(EvaluationScoreTotals.fromObjectives([])).toEqual(EvaluationScoreTotals.zero());
		expect(EvaluationScoreTotals.fromCommonEvaluationResults([])).toEqual(
			EvaluationScoreTotals.zero(),
		);
		expect(EvaluationAllocatedScores.zero().totalEvaluationScore).toBe(0);
	});
	it.each([NaN, Infinity, -1, null, undefined])("normalizes stored totals %s", (value) => {
		expect(
			EvaluationScoreTotals.fromValues({
				firstTotalScore: value,
				firstTotalRate: value,
				secondTotalScore: value,
				secondTotalRate: value,
			}),
		).toEqual(EvaluationScoreTotals.zero());
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
	it("updates milestone without modifying original or other evaluator", () => {
		const original = milestone();
		const changed = original.withScoreUpdates({ firstScore: 3 });
		expect(original.firstScore.value).toBe(2);
		expect(changed.secondScore.value).toBe(4);
		expect(
			changed.withTextUpdates({ challengeGoal: "new", midtermGoal: "mid", achievement: "done" })
				.firstScore.value,
		).toBe(3);
		expect(original.withScoreUpdates({ secondScore: 1 }).firstScore.value).toBe(2);
	});
	it("updates common result without modifying original or other evaluator", () => {
		const original = commonResult();
		expect(original.withFirstUpdate(4, " x ").firstComment.value).toBe("x");
		expect(original.withFirstUpdate(4, "x").secondScore.value).toBe(5);
		expect(original.withSecondUpdate(2).firstScore.value).toBe(3);
		expect(original.firstScore.value).toBe(3);
	});
	it("entity identity is stable across rehydration", () => {
		expect(employee().equals(employee())).toBe(true);
		expect(
			employee().equals(
				new (employee().constructor as typeof import("../entities/Employee").Employee)(
					9,
					"x",
					"x",
					1,
					null,
					null,
					null,
					null,
				),
			),
		).toBe(false);
		expect(profile().equals(profile())).toBe(true);
		expect(period().equals(period())).toBe(true);
		expect(commonResult().item.equals(commonResult().item)).toBe(true);
		expect(sheet().equals(sheet())).toBe(true);
		expect(sheet(EvaluationStatus.DRAFT).isEditable()).toBe(true);
		expect(sheet(EvaluationStatus.FINALIZED).isEditable()).toBe(false);
	});
});
