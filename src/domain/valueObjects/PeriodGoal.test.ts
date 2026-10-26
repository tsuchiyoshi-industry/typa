import { describe, expect, it } from "vitest";
import { sheet } from "../../test/fixtures";
import { Milestone } from "../entities/Milestone";
import { describeMilestoneError } from "../entities/MilestoneError";
import { EvaluationStatus } from "./EvaluationStatus";
import { addPeriodGoal, MAX_PERIOD_GOALS, toPeriodGoals } from "./PeriodGoal";

const task = (description: string, achievement = "") => ({ description, achievement });
const params = (periodGoals: unknown = [task("手順書を作る")], achievement = "") => ({
	id: 1,
	sheetId: 1,
	goalNumber: 1,
	challengeGoal: "テーマ",
	periodGoals: periodGoals as never,
	achievement,
});
const goal = (periodGoals = [task("手順書を作る")], achievement = "") =>
	Milestone.restore(params(periodGoals, achievement));
const failure = (result: { ok: boolean; error?: unknown }) => (result.ok ? null : result.error);

describe("period goals", () => {
	it("allows 0 to MAX_PERIOD_GOALS tasks and says when there are more", () => {
		expect(MAX_PERIOD_GOALS).toBe(4);
		expect(toPeriodGoals([])).toEqual({ ok: true, value: [] });
		expect(toPeriodGoals(Array.from({ length: 4 }, () => task("a"))).ok).toBe(true);
		expect(failure(toPeriodGoals(Array.from({ length: 5 }, () => task("a"))))).toEqual({
			kind: "tooManyPeriodGoals",
			max: 4,
		});
	});

	it.each([
		["not an array", "[]"],
		["null task", [null]],
		["missing achievement", [{ description: "a" }]],
		["number", [{ description: 1, achievement: "" }]],
		["extra key", [{ description: "a", achievement: "", done: true }]],
	])("reports malformed input as such (%s)", (_, value) => {
		expect(failure(toPeriodGoals(value))).toEqual({ kind: "periodGoalsMalformed" });
	});

	it("copies the tasks so a caller cannot change them afterwards", () => {
		const input = [task("a", "x")];
		const copied = toPeriodGoals(input);
		input[0].achievement = "changed";
		expect(copied.ok && copied.value[0].achievement).toBe("x");
	});

	it("moves the challenge achievement into the first task instead of dropping it", () => {
		expect(addPeriodGoal([], "テーマの実績")).toEqual({
			ok: true,
			value: { periodGoals: [task("", "テーマの実績")], achievement: "" },
		});
		expect(addPeriodGoal([task("a", "x")], "")).toEqual({
			ok: true,
			value: { periodGoals: [task("a", "x"), task("")], achievement: "" },
		});
		expect(
			failure(
				addPeriodGoal(
					Array.from({ length: 4 }, () => task("a")),
					"",
				),
			),
		).toEqual({
			kind: "tooManyPeriodGoals",
			max: 4,
		});
	});
});

describe("milestone text", () => {
	it("keeps the challenge achievement only while there are no tasks", () => {
		expect(goal([], "テーマの実績").achievement).toBe("テーマの実績");
		expect(failure(Milestone.from(params([task("a")], "テーマの実績")))).toEqual({
			kind: "achievementBesideTasks",
		});
		expect(
			failure(
				goal([]).withTextUpdates({
					challengeGoal: "テーマ",
					periodGoals: [task("a")],
					achievement: "残った実績",
				}),
			),
		).toEqual({ kind: "achievementBesideTasks" });
	});

	it("refuses to restore stored data that breaks the rules, as a data error", () => {
		expect(() => goal([task("a")], "テーマの実績")).toThrow("期中目標があるときは");
		expect(() => Milestone.restore(params([null]))).toThrow("期中目標は0〜4件");
	});

	it("after the goals are confirmed, changes only the achievements", () => {
		const fixed = goal([task("手順書を作る"), task("共有する")]);
		const next = fixed.withAchievementUpdates({
			periodGoals: [task("手順書を作る", "作成済み"), task("共有する", "未着手")],
		});
		expect(next.ok && next.value.periodGoals.map((item) => item.achievement)).toEqual([
			"作成済み",
			"未着手",
		]);

		for (const change of [
			{ periodGoals: [task("手順書を直す"), task("共有する")] },
			{ periodGoals: [task("共有する"), task("手順書を作る")] },
			{ periodGoals: [task("手順書を作る")] },
			{ periodGoals: [task("手順書を作る"), task("共有する"), task("追加")] },
			{ challengeGoal: "別のテーマ" },
		]) {
			expect(failure(fixed.withAchievementUpdates(change))).toEqual({ kind: "goalsFixed" });
		}
		expect(failure(fixed.withAchievementUpdates({ achievement: "テーマの実績" }))).toEqual({
			kind: "achievementBesideTasks",
		});
		const theme = goal([]).withAchievementUpdates({ achievement: "テーマの実績" });
		expect(theme.ok && theme.value.achievement).toBe("テーマの実績");
	});

	it("words every failure for the person who caused it", () => {
		expect(describeMilestoneError({ kind: "goalsFixed" })).toBe(
			"目標確定後は達成状況だけを編集できます。",
		);
		expect(describeMilestoneError({ kind: "tooManyPeriodGoals", max: 4 })).toContain("4件");
		expect(describeMilestoneError({ kind: "achievementBesideTasks" })).toContain(
			"期中目標があるときは",
		);
		expect(describeMilestoneError({ kind: "periodGoalsMalformed" })).toContain("0〜4件");
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
