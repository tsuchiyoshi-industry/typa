import { describe, expect, it } from "vitest";
import { commonResult, employee, milestone, period, profile, sheet } from "../../test/fixtures";
import { EvaluationSheet } from "../entities/EvaluationSheet";
import { Comment } from "./Comment";
import { EMPLOYEE_ROLE_NAMES, EmployeeRole } from "./EmployeeRole";
import { EvaluationAllocatedScores } from "./EvaluationAllocatedScores";
import { EvaluationRank } from "./EvaluationRank";
import { EvaluationScoreTotals } from "./EvaluationScoreTotals";
import { EvaluationStatus } from "./EvaluationStatus";
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
	it.each(["draft", "submitted", "first_evaluated", "finalized"])(
		"round trips status %s",
		(value) => {
			const status = EvaluationStatus.from(value);
			expect(status.toString()).toBe(value);
			expect(status.isDraft()).toBe(value === "draft");
			expect(status.isSubmitted()).toBe(value !== "draft");
			expect(status.isAwaitingFirstEvaluation()).toBe(value === "submitted");
			expect(status.isAwaitingSecondEvaluation()).toBe(value === "first_evaluated");
			expect(status.isFirstEvaluationConfirmed()).toBe(
				value === "first_evaluated" || value === "finalized",
			);
			expect(status.isFinalized()).toBe(value === "finalized");
			expect(status.equals(EvaluationStatus.from(value))).toBe(true);
		},
	);
	it.each([
		[100, "S"],
		[95, "S"],
		[94.9, "A"],
		[90, "A"],
		[89, "B+"],
		[80, "B+"],
		[79, "B"],
		[60, "B"],
		[59, "B-"],
		[50, "B-"],
		[49, "C"],
		[40, "C"],
		[39, "D"],
		[0, "D"],
	])("decides the rank mechanically from a score rate of %s%% as %s", (rate, rank) => {
		expect(EvaluationRank.fromScoreRate(rate).toDisplayText()).toBe(rank);
	});
	it("rates a score against the full score, and treats no full score as zero", () => {
		expect(EvaluationRank.fromScore(19, 20).toDisplayText()).toBe("S");
		expect(EvaluationRank.fromScore(58, 100).toDisplayText()).toBe("B-");
		expect(EvaluationRank.fromScore(5, 0).toDisplayText()).toBe("D");
	});
	it("round trips ranks through display text, including ranks entered by hand in the past", () => {
		for (const text of ["S", "A", "B+", "B", "B-", "C", "D", "F-"]) {
			expect(EvaluationRank.fromText(text)?.toDisplayText()).toBe(text);
		}
		expect(EvaluationRank.from("S", "plus").toDisplayText()).toBe("S+");
		expect(EvaluationRank.fromOptional("A", "none")?.toDisplayText()).toBe("A");
		expect(EvaluationRank.fromOptional()).toBeUndefined();
		expect(EvaluationRank.fromText(null)).toBeUndefined();
		expect(EvaluationRank.fromText("")).toBeUndefined();
		expect(() => EvaluationRank.fromText("Z")).toThrow();
	});
	it.each([
		["X", "none"],
		["A", "bad"],
	])("rejects rank %s/%s", (letter, level) =>
		expect(() => EvaluationRank.fromOptional(letter, level)).toThrow(),
	);
	it("uses the stored rank only for a confirmed stage, otherwise the rank of the current score", () => {
		// フィクスチャの保存値は A+。一次評価 58点 → B-、二次評価 100点 → S
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
		expect(submitted.firstEvaluationScore()).toBe(58);
		expect(submitted.resolveFirstEvaluationRank().toDisplayText()).toBe("B-");
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
	it("keeps roles to the known values and treats an unknown stored name as the weakest role", () => {
		expect(EmployeeRole.ALL.map(String)).toEqual([...EMPLOYEE_ROLE_NAMES]);
		expect(EmployeeRole.find("Admin")).toBe(EmployeeRole.ADMIN);
		expect(EmployeeRole.find("admin")).toBeUndefined();
		for (const stored of ["Owner", "", null, undefined]) {
			expect(EmployeeRole.fromStored(stored)).toBe(EmployeeRole.EMPLOYEE);
		}
		expect(EmployeeRole.ALL.filter((role) => role.isAdmin())).toEqual([EmployeeRole.ADMIN]);
		expect(EmployeeRole.REVIEWER.equals(EmployeeRole.fromStored("Reviewer"))).toBe(true);
		expect(EmployeeRole.REVIEWER.equals(EmployeeRole.EMPLOYEE)).toBe(false);
	});
});
