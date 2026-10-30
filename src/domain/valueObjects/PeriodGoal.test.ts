import { describe, expect, it } from "vitest";
import { Milestone } from "../entities/Milestone";
import { describeMilestoneError } from "../entities/MilestoneError";
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

	it("does not let a draft gain achievement text before the goals are confirmed", () => {
		const draft = goal([task("手順書を作る")]);
		for (const change of [
			{ periodGoals: [task("手順書を作る", "作成済み")] },
			{ periodGoals: [task("手順書を作る"), task("共有する", "済み")] },
		]) {
			expect(failure(draft.withTextUpdates(change))).toEqual({
				kind: "achievementBeforeConfirmation",
			});
		}
		expect(failure(goal([]).withTextUpdates({ achievement: "テーマの実績" }))).toEqual({
			kind: "achievementBeforeConfirmation",
		});
		// 目標の本文は今までどおり書ける
		const edited = draft.withTextUpdates({ periodGoals: [task("手順書を直す"), task("共有する")] });
		expect(edited.ok).toBe(true);
	});

	it("keeps or clears an achievement written before this rule, but never adds new text", () => {
		const legacy = goal([task("手順書を作る", "以前の実績"), task("共有する")]);
		// 本文だけ直しても、以前の達成状況はそのまま残る
		const kept = legacy.withTextUpdates({
			periodGoals: [task("手順書を直す", "以前の実績"), task("共有する")],
		});
		expect(kept.ok && kept.value.periodGoals[0].achievement).toBe("以前の実績");
		// 並べ替え・消すのはよい
		expect(
			legacy.withTextUpdates({
				periodGoals: [task("共有する"), task("手順書を作る", "以前の実績")],
			}).ok,
		).toBe(true);
		expect(legacy.withTextUpdates({ periodGoals: [task("手順書を作る")] }).ok).toBe(true);
		// 書き換えるのは、新しく書くのと同じ
		expect(
			failure(
				legacy.withTextUpdates({
					periodGoals: [task("手順書を作る", "以前の実績に追記"), task("共有する")],
				}),
			),
		).toEqual({ kind: "achievementBeforeConfirmation" });
	});

	it("words every failure for the person who caused it", () => {
		expect(describeMilestoneError({ kind: "achievementBeforeConfirmation" })).toBe(
			"達成状況は、一次評価者が目標を確定してから書けます。",
		);
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
