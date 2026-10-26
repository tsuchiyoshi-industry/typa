import { describe, expect, it } from "vitest";
import { sheet } from "../../test/fixtures";
import { DomainError } from "../DomainError";
import { Milestone } from "../entities/Milestone";
import { EvaluationStatus } from "./EvaluationStatus";
import { addPeriodGoal, assertPeriodGoals, copyPeriodGoals, MAX_PERIOD_GOALS } from "./PeriodGoal";

const task = (description: string, achievement = "") => ({ description, achievement });
const goal = (periodGoals = [task("手順書を作る")], achievement = "") =>
	Milestone.create({
		id: 1,
		sheetId: 1,
		goalNumber: 1,
		challengeGoal: "テーマ",
		periodGoals,
		achievement,
	});

describe("period goals", () => {
	it("allows 0 to MAX_PERIOD_GOALS tasks", () => {
		expect(MAX_PERIOD_GOALS).toBe(4);
		expect(() => assertPeriodGoals([])).not.toThrow();
		expect(() => assertPeriodGoals(Array.from({ length: 4 }, () => task("a")))).not.toThrow();
		expect(() => assertPeriodGoals(Array.from({ length: 5 }, () => task("a")))).toThrow(
			DomainError,
		);
	});

	it.each([
		["not an array", "[]"],
		["null task", [null]],
		["missing achievement", [{ description: "a" }]],
		["number", [{ description: 1, achievement: "" }]],
		["extra key", [{ description: "a", achievement: "", done: true }]],
	])("rejects malformed input as a DomainError (%s)", (_, value) => {
		expect(() => assertPeriodGoals(value)).toThrow(DomainError);
		expect(() => copyPeriodGoals(value as never)).toThrow(DomainError);
	});

	it("moves the challenge achievement into the first task instead of dropping it", () => {
		expect(addPeriodGoal([], "テーマの実績")).toEqual({
			periodGoals: [task("", "テーマの実績")],
			achievement: "",
		});
		expect(addPeriodGoal([task("a", "x")], "")).toEqual({
			periodGoals: [task("a", "x"), task("")],
			achievement: "",
		});
		expect(() =>
			addPeriodGoal(
				Array.from({ length: 4 }, () => task("a")),
				"",
			),
		).toThrow(DomainError);
	});
});

describe("milestone text", () => {
	it("keeps the challenge achievement only while there are no tasks", () => {
		expect(goal([], "テーマの実績").achievement).toBe("テーマの実績");
		expect(() => goal([task("a")], "テーマの実績")).toThrow(DomainError);
		expect(() =>
			goal([]).withTextUpdates({
				challengeGoal: "テーマ",
				periodGoals: [task("a")],
				achievement: "残った実績",
			}),
		).toThrow(DomainError);
	});

	it("after the goals are confirmed, changes only the achievements", () => {
		const fixed = goal([task("手順書を作る"), task("共有する")]);
		const next = fixed.withAchievementUpdates({
			periodGoals: [task("手順書を作る", "作成済み"), task("共有する", "未着手")],
		});
		expect(next.periodGoals.map((item) => item.achievement)).toEqual(["作成済み", "未着手"]);
		expect(next.challengeGoal).toBe("テーマ");

		for (const periodGoals of [
			[task("手順書を直す"), task("共有する")],
			[task("共有する"), task("手順書を作る")],
			[task("手順書を作る")],
			[task("手順書を作る"), task("共有する"), task("追加")],
		]) {
			expect(() => fixed.withAchievementUpdates({ periodGoals })).toThrow(
				"目標確定後は達成状況だけを編集できます。",
			);
		}
		expect(() => fixed.withAchievementUpdates({ challengeGoal: "別のテーマ" })).toThrow(
			DomainError,
		);
		expect(() => fixed.withAchievementUpdates({ achievement: "テーマの実績" })).toThrow(
			DomainError,
		);
		expect(goal([]).withAchievementUpdates({ achievement: "テーマの実績" }).achievement).toBe(
			"テーマの実績",
		);
	});
});

describe("evaluation status", () => {
	it("starts scoring only once the achievements are submitted", () => {
		expect(EvaluationStatus.ALL.filter((s) => s.isEvaluationStarted()).map(String)).toEqual([
			"submitted",
			"first_evaluated",
			"finalized",
		]);
		expect(EvaluationStatus.ALL.filter((s) => s.isSentToEvaluators()).map(String)).not.toContain(
			"draft",
		);
	});

	it("names who handed the sheet to whom in each status", () => {
		expect(
			Object.fromEntries(EvaluationStatus.ALL.map((s) => [s.toString(), s.handoff()])),
		).toEqual({
			draft: { from: "primary", to: "subject" },
			goals_submitted: { from: "subject", to: "primary" },
			goals_confirmed: { from: "primary", to: "subject" },
			submitted: { from: "subject", to: "primary" },
			first_evaluated: { from: "primary", to: "secondary" },
			finalized: null,
		});
	});
});

describe("sheet status change", () => {
	it("copies the sheet with only the status changed", () => {
		const before = sheet(EvaluationStatus.GOALS_SUBMITTED);
		const after = before.withStatus(EvaluationStatus.DRAFT);
		expect(after.status).toBe(EvaluationStatus.DRAFT);
		expect(before.status).toBe(EvaluationStatus.GOALS_SUBMITTED);
		const { status: _a, ...rest } = after;
		const { status: _b, ...original } = before;
		expect(rest).toEqual(original);
	});
});
