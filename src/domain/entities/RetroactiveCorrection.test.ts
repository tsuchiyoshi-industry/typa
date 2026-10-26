import { describe, expect, it } from "vitest";
import { commonResult, milestone, period, sheet } from "../../test/fixtures";
import { DomainError } from "../DomainError";
import { EvaluationSheetAccessPolicy } from "../services/EvaluationSheetAccessPolicy";
import { CorrectionField } from "../valueObjects/CorrectionField";
import { CorrectionReason } from "../valueObjects/CorrectionReason";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { Employee } from "./Employee";
import { EvaluationSheet } from "./EvaluationSheet";
import { Milestone } from "./Milestone";
import { type RequestedChange, RetroactiveCorrection } from "./RetroactiveCorrection";
import { SheetCorrection } from "./SheetCorrection";

// fixtures: 目標 id 11(目標番号1、一次2・二次4、達成状況「達成」)、共通評価の項目 id 31「共通項目」(一次3・二次4)
const closed = () => sheet(EvaluationStatus.FINALIZED, undefined, true);
const propose = (changes: RequestedChange[], reason = "評価会議での訂正", target = closed()) =>
	RetroactiveCorrection.propose(target, changes, reason);

describe("correction field and reason", () => {
	it("allows only the items a correction may change, and names them", () => {
		expect(CorrectionField.of("goal", "achievement").label).toBe("達成状況");
		expect(CorrectionField.of("common", "first_comment").stage).toBe("first");
		expect(CorrectionField.of("sheet", "second_overall_comment").stage).toBe("second");
		for (const [target, field] of [
			["goal", "first_comment"],
			["common", "achievement"],
			["sheet", "first_score"],
			["sheet", "status"],
			["goal", "final_rank"],
			["period", "is_active"],
			["", ""],
		]) {
			expect(() => CorrectionField.of(target, field)).toThrow("遡及処理で直せない項目です。");
		}
	});

	it.each(["0", "5", "", "3.5", " 3", "三", "4 "])("rejects score %j", (value) => {
		expect(() => CorrectionField.of("goal", "first_score").assertValid(value)).toThrow(
			"点数は 1〜4 で入力してください。",
		);
	});

	it("limits text to 2000 characters and shows empty values readably", () => {
		const text = CorrectionField.of("goal", "achievement");
		expect(() => text.assertValid("あ".repeat(2000))).not.toThrow();
		expect(() => text.assertValid("あ".repeat(2001))).toThrow("2000 文字以内");
		expect([text.display(""), CorrectionField.of("goal", "second_score").display("0")]).toEqual([
			"(空欄)",
			"未評価",
		]);
	});

	it.each(["", "   ", "理".repeat(501)])("needs a reason of 1 to 500 characters (%j)", (value) => {
		expect(() => CorrectionReason.from(value)).toThrow(DomainError);
	});
});

describe("period goal corrections", () => {
	const tasks = (achievement = "達成") =>
		JSON.stringify([{ description: "手順を見直す", achievement }]);
	const noTasks = () =>
		EvaluationSheet.create({
			...closed(),
			objectives: [
				Milestone.create({
					id: 11,
					sheetId: 100,
					goalNumber: 1,
					challengeGoal: "目標",
					achievement: "テーマの実績",
				}),
			],
		});

	it("knows no field for the misused name 中間目標; the task list is the only way to correct period goals", () => {
		for (const field of ["midterm_goal", "period_goal_description"]) {
			expect(() => CorrectionField.of("goal", field)).toThrow("遡及処理で直せない項目です。");
			expect(() => propose([{ target: "goal", targetId: 11, field, value: "新" }])).toThrow(
				"遡及処理で直せない項目です。",
			);
		}
	});

	it("corrects a task's achievement through the task list", () => {
		const correction = propose([
			{ target: "goal", targetId: 11, field: "period_goals", value: tasks("訂正") },
		]);
		expect(correction.changes[0].afterText).toBe("1. 手順を見直す（達成状況: 訂正）");
	});

	it("keeps the challenge achievement only while there are no tasks", () => {
		expect(() =>
			propose([{ target: "goal", targetId: 11, field: "achievement", value: "テーマの実績" }]),
		).toThrow("期中目標があるときは");
		expect(() =>
			propose(
				[{ target: "goal", targetId: 11, field: "period_goals", value: tasks() }],
				"訂正",
				noTasks(),
			),
		).toThrow("期中目標があるときは");
		const moved = propose(
			[
				{ target: "goal", targetId: 11, field: "period_goals", value: tasks("テーマの実績") },
				{ target: "goal", targetId: 11, field: "achievement", value: "" },
			],
			"訂正",
			noTasks(),
		);
		expect(moved.changes.map((change) => change.field.value)).toEqual([
			"period_goals",
			"achievement",
		]);
	});

	it("shows a broken stored task list as it is instead of failing", () => {
		expect(CorrectionField.of("goal", "period_goals").display("{broken")).toBe("{broken");
	});
});

describe("retroactive correction", () => {
	it("plans each change with the value it replaces", () => {
		const correction = propose([
			{ target: "goal", targetId: 11, field: "second_score", value: "3" },
			{ target: "common", targetId: 31, field: "first_comment", value: "訂正後のコメント" },
			{ target: "sheet", targetId: null, field: "second_overall_comment", value: "訂正後の総評" },
		]);
		expect(correction.reason.toString()).toBe("評価会議での訂正");
		expect(
			correction.changes.map((change) => [change.subject, change.beforeText, change.afterText]),
		).toEqual([
			["チャレンジ目標 1・二次評価", "4", "3"],
			["共通評価「共通項目」・一次評価者コメント", "一次コメント", "訂正後のコメント"],
			["二次評価者の総評", "二次総評", "訂正後の総評"],
		]);
	});

	it.each([
		[
			"a sheet of the period in progress",
			sheet(EvaluationStatus.FINALIZED),
			"締め済みの評価期間のシートだけ",
		],
		[
			"a sheet of a period not yet closed",
			sheet(EvaluationStatus.DRAFT),
			"締め済みの評価期間のシートだけ",
		],
	])("refuses %s", (_label, target, message) => {
		expect(() =>
			propose(
				[{ target: "goal", targetId: 11, field: "second_score", value: "3" }],
				"訂正",
				target,
			),
		).toThrow(message);
	});

	it.each([
		["no change", [], "修正する項目がありません。"],
		[
			"a goal of another sheet",
			[{ target: "goal", targetId: 99, field: "achievement", value: "x" }],
			"このシートの目標ではありません。",
		],
		[
			"an item the sheet does not evaluate",
			[{ target: "common", targetId: 99, field: "first_score", value: "1" }],
			"このシートの共通評価の項目ではありません。",
		],
		[
			"the value it already has",
			[{ target: "goal", targetId: 11, field: "achievement", value: "" }],
			"今と同じ内容には修正できません。",
		],
		[
			"the same score it already has",
			[{ target: "common", targetId: 31, field: "second_score", value: "4" }],
			"今と同じ内容には修正できません。",
		],
		[
			"the same item twice",
			[
				{ target: "goal", targetId: 11, field: "first_score", value: "3" },
				{ target: "goal", targetId: 11, field: "first_score", value: "4" },
			],
			"同じ項目を一度に2回直すことはできません。",
		],
		[
			"a score outside 1 to 4",
			[{ target: "goal", targetId: 11, field: "first_score", value: "0" }],
			"点数は 1〜4",
		],
	] as [string, RequestedChange[], string][])("refuses %s", (_label, changes, message) => {
		expect(() => propose(changes)).toThrow(message);
	});

	it("refuses a blank reason even when the changes are right", () => {
		expect(() =>
			propose([{ target: "goal", targetId: 11, field: "achievement", value: "訂正" }], "  "),
		).toThrow("修正の理由を 500 文字以内で入力してください。");
	});

	it("has no second score to correct when the primary evaluator is final", () => {
		const withoutSecondary = EvaluationSheet.create({
			sheetId: 100,
			subject: new Employee(1, "テスト社員", "TEST001", 1, "技術", 5, 2, null, true),
			evaluationPeriod: period(false),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "なし",
			objectives: [milestone()],
			commonEvaluationResults: [commonResult()],
			status: EvaluationStatus.FINALIZED,
		});
		expect(() =>
			propose(
				[{ target: "goal", targetId: 11, field: "second_score", value: "3" }],
				"訂正",
				withoutSecondary,
			),
		).toThrow("二次評価者を置かないシートには、二次評価点はありません。");
		expect(
			propose(
				[{ target: "goal", targetId: 11, field: "first_score", value: "3" }],
				"訂正",
				withoutSecondary,
			).changes,
		).toHaveLength(1);
	});
});

describe("who sees a correction", () => {
	const corrected = (target: string, field: string) =>
		SheetCorrection.restore({
			id: 1,
			target,
			field,
			goalNumber: 1,
			itemTitle: "共通項目",
			before: "3",
			after: "4",
			reason: "訂正",
			correctedAt: "2026-10-23T10:00:00+09:00",
		});
	const sees = (viewer: number | null, status: EvaluationStatus, target: string, field: string) =>
		EvaluationSheetAccessPolicy.for(viewer, sheet(status, undefined, true)).canViewCorrection(
			corrected(target, field),
		);

	it("shows a correction exactly to those who may see the corrected item", () => {
		const finalized = EvaluationStatus.FINALIZED;
		// 本人(1): 確定後は点数も見られる。共通評価と総評は見ない
		expect(sees(1, finalized, "goal", "achievement")).toBe(true);
		expect(sees(1, finalized, "goal", "second_score")).toBe(true);
		expect(sees(1, finalized, "common", "first_score")).toBe(false);
		expect(sees(1, finalized, "sheet", "second_overall_comment")).toBe(false);
		// 一次評価者(2): 二次評価の修正は見ない
		expect(sees(2, finalized, "goal", "first_score")).toBe(true);
		expect(sees(2, finalized, "goal", "second_score")).toBe(false);
		expect(sees(2, finalized, "common", "second_score")).toBe(false);
		expect(sees(2, finalized, "sheet", "first_overall_comment")).toBe(true);
		// 二次評価者(3): すべて見る
		expect(sees(3, finalized, "common", "second_score")).toBe(true);
		// 関係のない人(4)や、ログインしていない人には見せない
		expect(sees(4, finalized, "goal", "achievement")).toBe(false);
		expect(sees(null, finalized, "goal", "achievement")).toBe(false);
	});

	it("keeps unconfirmed scores and their corrections from the subject of a sheet closed without finalizing", () => {
		const draft = EvaluationStatus.DRAFT;
		expect(sees(1, draft, "goal", "achievement")).toBe(true);
		expect(sees(1, draft, "goal", "first_score")).toBe(false);
		expect(sees(2, draft, "goal", "first_score")).toBe(true);
	});

	it("names what was corrected and how", () => {
		expect(
			[
				corrected("goal", "second_score"),
				corrected("common", "first_score"),
				corrected("sheet", "first_overall_comment"),
			].map((c) => c.subject),
		).toEqual(["チャレンジ目標 1・二次評価", "共通評価「共通項目」・一次評価", "一次評価者の総評"]);
	});
});
