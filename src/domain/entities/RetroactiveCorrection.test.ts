import { describe, expect, it } from "vitest";
import { commonResult, milestone, period, sheet } from "../../test/fixtures";
import { EvaluationSheetAccessPolicy } from "../services/EvaluationSheetAccessPolicy";
import { CorrectionField } from "../valueObjects/CorrectionField";
import { CorrectionReason } from "../valueObjects/CorrectionReason";
import { EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { type CorrectionError, describeCorrectionError } from "./CorrectionError";
import { Employee } from "./Employee";
import { EvaluationSheet } from "./EvaluationSheet";
import { Milestone } from "./Milestone";
import { type RequestedChange, RetroactiveCorrection } from "./RetroactiveCorrection";
import { SheetCorrection } from "./SheetCorrection";

// fixtures: 目標 id 11(目標番号1、一次2・二次4、期中目標1件)、共通評価の項目 id 31「共通項目」(一次3・二次4)
const closed = () => sheet(EvaluationStatus.FINALIZED, undefined, true);
const propose = (changes: RequestedChange[], reason = "評価会議での訂正", target = closed()) =>
	RetroactiveCorrection.propose(target, changes, reason);
/** 成功した結果の中身。失敗していたらテストを止める。 */
const value = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) {
		throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
	}
	return result.value;
};
const failure = <E>(result: { ok: true } | { ok: false; error: E }): E | null =>
	result.ok ? null : result.error;
const field = (target: string, name: string) => value(CorrectionField.of(target, name));

describe("correction field and reason", () => {
	it("allows only the items a correction may change, and names them", () => {
		expect(field("goal", "achievement").label).toBe("達成状況");
		expect(field("common", "first_comment").stage).toBe("first");
		expect(field("sheet", "second_overall_comment").stage).toBe("second");
		for (const [target, name] of [
			["goal", "first_comment"],
			["common", "achievement"],
			["sheet", "first_score"],
			["sheet", "status"],
			["goal", "final_rank"],
			["period", "is_active"],
			["goal", "constructor"],
			["", ""],
		]) {
			expect(failure(CorrectionField.of(target, name))).toEqual({ kind: "fieldNotCorrectable" });
		}
		expect(describeCorrectionError({ kind: "fieldNotCorrectable" })).toBe(
			"遡及処理で直せない項目です。",
		);
	});

	it.each(["0", "5", "", "3.5", " 3", "三", "4 "])("rejects score %j", (score) => {
		expect(failure(field("goal", "first_score").validate(score))).toEqual({ kind: "scoreInvalid" });
	});

	it("limits text to 2000 characters, also in each task, and shows empty values readably", () => {
		const text = field("goal", "achievement");
		expect(text.validate("あ".repeat(2000)).ok).toBe(true);
		expect(failure(text.validate("あ".repeat(2001)))).toEqual({ kind: "textTooLong", max: 2000 });
		const tasks = field("goal", "period_goals");
		expect(failure(tasks.validate("{broken"))).toEqual({ kind: "periodGoalsMalformed" });
		expect(
			failure(
				tasks.validate(JSON.stringify([{ description: "あ".repeat(2001), achievement: "" }])),
			),
		).toEqual({ kind: "textTooLong", max: 2000 });
		expect([text.display(""), field("goal", "second_score").display("0")]).toEqual([
			"(空欄)",
			"未評価",
		]);
	});

	it.each(["", "   ", "理".repeat(501)])("needs a reason of 1 to 500 characters (%j)", (reason) => {
		expect(failure(CorrectionReason.from(reason))).toEqual({ kind: "reasonInvalid", max: 500 });
	});
});

describe("period goal corrections", () => {
	const tasks = (achievement = "達成") =>
		JSON.stringify([{ description: "手順を見直す", achievement }]);
	const noTasks = () =>
		EvaluationSheet.create({
			sheetId: 100,
			subject: closed().subject,
			evaluationPeriod: closed().evaluationPeriod,
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			commonEvaluationResults: [commonResult()],
			status: EvaluationStatus.FINALIZED,
			objectives: [
				Milestone.restore({
					id: 11,
					sheetId: 100,
					goalNumber: 1,
					challengeGoal: "目標",
					achievement: "テーマの実績",
				}),
			],
		});

	it("knows no field for the misused name 中間目標; the task list is the only way to correct period goals", () => {
		for (const name of ["midterm_goal", "period_goal_description"]) {
			expect(failure(CorrectionField.of("goal", name))).toEqual({ kind: "fieldNotCorrectable" });
			expect(
				failure(propose([{ target: "goal", targetId: 11, field: name, value: "新" }])),
			).toEqual({ kind: "fieldNotCorrectable" });
		}
	});

	it("corrects the achievement of a task through the task list", () => {
		const correction = value(
			propose([{ target: "goal", targetId: 11, field: "period_goals", value: tasks("訂正") }]),
		);
		expect(correction.changes[0].afterText).toBe("1. 手順を見直す（達成状況: 訂正）");
	});

	it("keeps the challenge achievement only while there are no tasks", () => {
		const besideTasks: CorrectionError = {
			kind: "goalInvalid",
			goalNumber: 1,
			error: { kind: "achievementBesideTasks" },
		};
		expect(
			failure(
				propose([{ target: "goal", targetId: 11, field: "achievement", value: "テーマの実績" }]),
			),
		).toEqual(besideTasks);
		expect(
			failure(
				propose(
					[{ target: "goal", targetId: 11, field: "period_goals", value: tasks() }],
					"訂正",
					noTasks(),
				),
			),
		).toEqual(besideTasks);
		expect(describeCorrectionError(besideTasks)).toBe(
			"チャレンジ目標 1: 期中目標があるときは、達成状況を期中目標ごとに記入してください。",
		);
		const moved = value(
			propose(
				[
					{ target: "goal", targetId: 11, field: "period_goals", value: tasks("テーマの実績") },
					{ target: "goal", targetId: 11, field: "achievement", value: "" },
				],
				"訂正",
				noTasks(),
			),
		);
		expect(moved.changes.map((change) => change.field.value)).toEqual([
			"period_goals",
			"achievement",
		]);
	});

	it("shows a broken stored task list as it is instead of failing", () => {
		expect(field("goal", "period_goals").display("{broken")).toBe("{broken");
	});
});

describe("retroactive correction", () => {
	it("plans each change with the value it replaces", () => {
		const correction = value(
			propose([
				{ target: "goal", targetId: 11, field: "second_score", value: "3" },
				{ target: "common", targetId: 31, field: "first_comment", value: "訂正後のコメント" },
				{ target: "sheet", targetId: null, field: "second_overall_comment", value: "訂正後の総評" },
			]),
		);
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
		["a sheet of the period in progress", sheet(EvaluationStatus.FINALIZED)],
		["a sheet of a period not yet closed", sheet(EvaluationStatus.DRAFT)],
	])("refuses %s", (_label, target) => {
		const result = propose(
			[{ target: "goal", targetId: 11, field: "second_score", value: "3" }],
			"訂正",
			target,
		);
		expect(failure(result)).toEqual({ kind: "periodNotClosed" });
		expect(describeCorrectionError({ kind: "periodNotClosed" })).toContain(
			"締め済みの評価期間のシートだけ",
		);
	});

	it.each([
		["no change", [], { kind: "noChanges" }, "修正する項目がありません。"],
		[
			"a goal of another sheet",
			[{ target: "goal", targetId: 99, field: "achievement", value: "x" }],
			{ kind: "notThisSheetGoal" },
			"このシートの目標ではありません。",
		],
		[
			"an item the sheet does not evaluate",
			[{ target: "common", targetId: 99, field: "first_score", value: "1" }],
			{ kind: "notThisSheetItem" },
			"このシートの共通評価の項目ではありません。",
		],
		[
			"the value it already has",
			[{ target: "goal", targetId: 11, field: "achievement", value: "" }],
			{ kind: "sameValue", subject: "チャレンジ目標 1・達成状況" },
			"「チャレンジ目標 1・達成状況」は、今と同じ内容には修正できません。",
		],
		[
			"the same score it already has",
			[{ target: "common", targetId: 31, field: "second_score", value: "4" }],
			{ kind: "sameValue", subject: "共通評価「共通項目」・二次評価" },
			"今と同じ内容には修正できません。",
		],
		[
			"the same item twice",
			[
				{ target: "goal", targetId: 11, field: "first_score", value: "3" },
				{ target: "goal", targetId: 11, field: "first_score", value: "4" },
			],
			{ kind: "duplicate" },
			"同じ項目を一度に2回直すことはできません。",
		],
		[
			"a score outside 1 to 4",
			[{ target: "goal", targetId: 11, field: "first_score", value: "0" }],
			{ kind: "scoreInvalid" },
			"点数は 1〜4",
		],
	] as [string, RequestedChange[], CorrectionError, string][])(
		"refuses %s",
		(_label, changes, expected, message) => {
			const error = failure(propose(changes));
			expect(error).toEqual(expected);
			expect(describeCorrectionError(expected)).toContain(message);
		},
	);

	it("refuses a blank reason even when the changes are right", () => {
		const error = failure(
			propose([{ target: "goal", targetId: 11, field: "achievement", value: "訂正" }], "  "),
		);
		expect(error).toEqual({ kind: "reasonInvalid", max: 500 });
		expect(describeCorrectionError({ kind: "reasonInvalid", max: 500 })).toBe(
			"修正の理由を 500 文字以内で入力してください。",
		);
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
		expect(
			failure(
				propose(
					[{ target: "goal", targetId: 11, field: "second_score", value: "3" }],
					"訂正",
					withoutSecondary,
				),
			),
		).toEqual({ kind: "noSecondScore" });
		expect(
			value(
				propose(
					[{ target: "goal", targetId: 11, field: "first_score", value: "3" }],
					"訂正",
					withoutSecondary,
				),
			).changes,
		).toHaveLength(1);
	});
});

describe("who sees a correction", () => {
	const corrected = (target: string, name: string) =>
		SheetCorrection.restore({
			id: 1,
			target,
			field: name,
			goalNumber: 1,
			itemTitle: "共通項目",
			before: "3",
			after: "4",
			reason: "訂正",
			correctedAt: "2026-10-23T10:00:00+09:00",
		});
	const sees = (viewer: number | null, status: EvaluationStatus, target: string, name: string) =>
		EvaluationSheetAccessPolicy.for(viewer, sheet(status, undefined, true)).canViewCorrection(
			corrected(target, name),
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

	it("refuses to restore a stored correction of an unknown field, as a data error", () => {
		expect(() => corrected("goal", "midterm_goal")).toThrow("遡及処理で直せない項目です。");
	});
});
