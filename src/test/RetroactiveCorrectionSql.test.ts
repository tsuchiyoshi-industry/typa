import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []) =>
	(await query<{ v: T }>(sql, params))[0].v;
const correct = (sheet: number, changes: unknown[], reason = "評価会議での訂正") =>
	query("select public.correct_closed_sheet($1, $2, $3) as v", [
		sheet,
		JSON.stringify(changes),
		reason,
	]);
type Correction = { field: string; before: string; after: string; reason: string };
const correctionsSeenBy = async (employee: number, sheet: number) => {
	await actAs(db, employee);
	return (
		await one<{ corrections: Correction[] } | null>("select public.get_sheet($1) as v", [sheet])
	)?.corrections;
};

// 期間 2 は締め済み、期間 1 が実施中。
// 100: 社員 4 の評価確定のシート(目標1件 一次3・二次3、共通評価 二次3、配点 20/80 → 75 点)
// 300: 社員 6(二次評価者なし)の、評価せずに締めた下書き。 200: 実施中の期間の下書き
let goal100: number;
let goal300: number;
beforeAll(async () => {
	db = await createProdLikeDb("202610230004_z");
	await db.exec(`
		reset role;
		set session_replication_role = replica;
		insert into public.evaluation_sheets
		  (id, period_id, employee_id, status, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator,
		   grade_id, objective_allocation, common_allocation, total_evaluation_score, final_rank_letter, final_rank_level,
		   second_overall_comment)
		values (100, 2, 4, 'finalized', 2, 3, false, 1, 20, 80, 75, 'B', 'none', '二次の総評'),
		       (300, 2, 6, 'draft', 2, null, true, 1, null, null, null, null, null, ''),
		       (200, 1, 4, 'draft', 2, 3, false, 1, null, null, null, null, null, '');
		insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals, first_score, second_score)
		values (100, 1, '受注の手戻りを減らす', '[{"description":"手順を改善","achievement":"半減した"}]', 3, 3), (300, 1, '問い合わせを早く返す', '[{"description":"返答手順を改善","achievement":""}]', 0, 0),
		       (200, 1, '今期の目標', '[{"description":"今期のタスク","achievement":""}]', 0, 0);
		insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score)
		values (100, 1, 3, 3), (100, 2, 3, 3);
		set session_replication_role = origin;
	`);
	goal100 = await one<number>("select id as v from public.milestones where sheet_id = 100");
	goal300 = await one<number>("select id as v from public.milestones where sheet_id = 300");
}, 60_000);
afterAll(async () => {
	await db?.close();
});

/** 締めたシートの、修正で変わりうるものすべて。断られた修正の前後で比べる(ほかのテストの記録に寄りかからない)。 */
const snapshot = async () => {
	await db.exec("reset role");
	return {
		goals: await query(
			"select sheet_id, first_score, second_score, period_goals from public.milestones where sheet_id in (100, 300) order by id",
		),
		sheets: await query(
			"select id, total_evaluation_score, second_overall_comment from public.evaluation_sheets where id in (100, 300) order by id",
		),
		corrections: await one("select count(*)::int as v from public.sheet_corrections"),
		audits: await one(
			"select count(*)::int as v from public.security_audit_log where action = 'sheet.corrected'",
		),
	};
};

it("lets only an Admin read or correct a closed sheet, and never a sheet of the period in progress", async () => {
	const before = await snapshot();
	for (const employee of [2, 3, 4]) {
		await actAs(db, employee);
		await expect(query("select public.get_sheet_for_correction(100)")).rejects.toMatchObject({
			code: "42501",
		});
		await expect(
			correct(100, [{ target: "goal", targetId: goal100, field: "second_score", value: "4" }]),
		).rejects.toMatchObject({ code: "42501" });
	}
	await actAs(db, 1);
	await expect(query("select public.get_sheet_for_correction(200)")).rejects.toMatchObject({
		code: "23514",
		message: "遡及処理で修正できるのは、締め済みの評価期間のシートだけです。",
	});
	await expect(
		correct(200, [{ target: "sheet", field: "first_overall_comment", value: "x" }]),
	).rejects.toMatchObject({
		code: "23514",
	});
	await expect(
		correct(999, [{ target: "sheet", field: "first_overall_comment", value: "x" }]),
	).rejects.toMatchObject({
		code: "P0002",
	});
	expect(await snapshot()).toEqual(before);
});

it.each([
	["no change at all", [], "評価会議での訂正", "修正する項目がありません。"],
	[
		"no reason",
		[{ target: "goal", field: "second_score", value: "4" }],
		"   ",
		"修正の理由を 500 文字以内で入力してください。",
	],
	[
		"a reason over 500 characters",
		[{ target: "goal", field: "second_score", value: "4" }],
		"理".repeat(501),
		"500 文字以内",
	],
	[
		"a score of 5",
		[{ target: "goal", field: "second_score", value: "5" }],
		"訂正",
		"点数は 1〜4 で入力してください。",
	],
	[
		"a score of 0 (back to unrated)",
		[{ target: "goal", field: "first_score", value: "0" }],
		"訂正",
		"点数は 1〜4",
	],
	[
		"a field that cannot be corrected",
		[{ target: "sheet", field: "status", value: "draft" }],
		"訂正",
		"遡及処理で直せない項目です。",
	],
	[
		"a field of the wrong kind of item",
		[{ target: "common", field: "achievement", value: "x" }],
		"訂正",
		"遡及処理で直せない項目です。",
	],
	[
		"a goal of another sheet",
		[{ target: "goal", targetIdOf: 300, field: "achievement", value: "x" }],
		"訂正",
		"このシートの目標ではありません。",
	],
	[
		"an item outside the sheet's grade",
		[{ target: "common", targetId: 999, field: "first_score", value: "4" }],
		"訂正",
		"このシートの共通評価の項目ではありません。",
	],
	[
		"the value it already has",
		[{ target: "goal", field: "challenge_goal", value: "受注の手戻りを減らす" }],
		"訂正",
		"今と同じ内容には修正できません。",
	],
	[
		"a good change followed by a bad one",
		[
			{ target: "goal", field: "challenge_goal", value: "受注の手戻りをなくす" },
			{ target: "goal", field: "first_score", value: "9" },
		],
		"訂正",
		"点数は 1〜4",
	],
])("writes nothing for %s", async (_label, changes, reason, message) => {
	const before = await snapshot();
	await actAs(db, 1);
	const withIds = (changes as Record<string, unknown>[]).map(({ targetIdOf, ...change }) =>
		change.target === "goal"
			? { ...change, targetId: targetIdOf === 300 ? goal300 : goal100 }
			: change,
	);
	await expect(correct(100, withIds, reason as string)).rejects.toThrow(message as string);
	expect(await snapshot()).toEqual(before);
});

it("has no second score to correct on a sheet without a secondary evaluator", async () => {
	await actAs(db, 1);
	await expect(
		correct(300, [{ target: "goal", targetId: goal300, field: "second_score", value: "3" }]),
	).rejects.toThrow("二次評価者を置かないシートには、二次評価点はありません。");
});

it("still keeps every other write away from a closed sheet", async () => {
	await db.exec("reset role");
	await expect(
		query(
			`update public.milestones set period_goals = '[{"description":"書き換え","achievement":""}]' where sheet_id = 100`,
		),
	).rejects.toThrow("締められた評価期間の評価シートは変更できません。");
	await expect(
		query(
			"insert into public.sheet_corrections (sheet_id, target, field, after_value, reason) values (100, 'sheet', 'first_overall_comment', 'x', 'y')",
		),
	).resolves.toBeDefined();
	await db.exec("delete from public.sheet_corrections where reason = 'y'");
	// アプリからは記録を読むことも、消すことも書き足すこともできない
	await actAs(db, 1);
	await expect(query("select * from public.sheet_corrections")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(query("delete from public.sheet_corrections")).rejects.toMatchObject({
		code: "42501",
	});
});

// 修正を記録し、その記録を誰に見せるか。後の段が前の段の記録を読むので、順番どおりに流す
describe("recording corrections and showing them", { shuffle: false }, () => {
	it("records each correction and recalculates the finalized result with the allocation it was finalized with", async () => {
		await db.exec(
			"reset role; update public.evaluation_settings set objective_allocation = 50, common_allocation = 50",
		);
		await actAs(db, 1);
		expect(
			await one("select public.correct_closed_sheet(100, $1, '二次評価の転記ミス') as v", [
				JSON.stringify([
					{ target: "goal", targetId: goal100, field: "second_score", value: "4" },
					{ target: "goal", targetId: goal100, field: "achievement", value: "7割減らした" },
					{ target: "common", targetId: 2, field: "second_score", value: "4" },
					{ target: "sheet", field: "second_overall_comment", value: "訂正後の総評" },
				]),
			]),
		).toBe(4);
		await db.exec("reset role");
		expect(
			await query(
				"select target, goal_number, item_title, field, before_value, after_value, reason, corrected_by from public.sheet_corrections order by id",
			),
		).toEqual([
			{
				target: "goal",
				goal_number: 1,
				item_title: null,
				field: "second_score",
				before_value: "3",
				after_value: "4",
				reason: "二次評価の転記ミス",
				corrected_by: 1,
			},
			{
				target: "goal",
				goal_number: 1,
				item_title: null,
				field: "achievement",
				before_value: "半減した",
				after_value: "7割減らした",
				reason: "二次評価の転記ミス",
				corrected_by: 1,
			},
			{
				target: "common",
				goal_number: null,
				item_title: "専門性",
				field: "second_score",
				before_value: "3",
				after_value: "4",
				reason: "二次評価の転記ミス",
				corrected_by: 1,
			},
			{
				target: "sheet",
				goal_number: null,
				item_title: null,
				field: "second_overall_comment",
				before_value: "二次の総評",
				after_value: "訂正後の総評",
				reason: "二次評価の転記ミス",
				corrected_by: 1,
			},
		]);
		// 目標 4/4 → 20 点、共通評価 (2×3 + 3×4)/20 → 72 点。配点は確定時の 20/80 のまま
		expect(
			await query(
				"select status, total_evaluation_score, objective_allocation, common_allocation, final_rank_letter || final_rank_level as rank, second_overall_comment from public.evaluation_sheets where id = 100",
			),
		).toEqual([
			{
				status: "finalized",
				total_evaluation_score: 92,
				objective_allocation: 20,
				common_allocation: 80,
				rank: await one(
					"select left(public.evaluation_rank(92), 1) || case right(public.evaluation_rank(92), 1) when '+' then 'plus' when '-' then 'minus' else 'none' end as v",
				),
				second_overall_comment: "訂正後の総評",
			},
		]);
		expect(
			await one(
				"select count(*)::int as v from public.security_audit_log where action = 'sheet.corrected'",
			),
		).toBe(1);
	});

	it("shows a correction only to those who may see the corrected item", async () => {
		await actAs(db, 1);
		await correct(300, [
			{ target: "goal", targetId: goal300, field: "first_score", value: "2" },
			{ target: "goal", targetId: goal300, field: "achievement", value: "期限内に返した" },
		]);
		// 評価せずに締めた下書きの一次評価点は、本人には見せない(修正も見せない)。目標の文言の修正は見せる
		expect((await correctionsSeenBy(6, 300))?.map((c) => c.field)).toEqual(["achievement"]);
		expect((await correctionsSeenBy(2, 300))?.map((c) => c.field)).toEqual([
			"first_score",
			"achievement",
		]);
		expect(await correctionsSeenBy(5, 300)).toBeUndefined();
		// 評価確定のシートは、本人にもすべての修正を見せる
		expect(
			(await correctionsSeenBy(4, 100))?.map((c) => `${c.field}:${c.before}→${c.after}`),
		).toEqual([
			"second_score:3→4",
			"achievement:半減した→7割減らした",
			"second_score:3→4",
			"second_overall_comment:二次の総評→訂正後の総評",
		]);
		// DB は値を返す範囲の修正を返す(評価確定後は一次評価者にも二次評価を返す)。
		// 一次評価者に二次評価を見せないのは、画面の EvaluationSheetAccessPolicy が値と修正の両方で決める
		expect((await correctionsSeenBy(2, 100))?.map((c) => c.field)).toHaveLength(4);
		// Admin は修正の画面ですべて読む
		await actAs(db, 1);
		expect(
			(
				await one<{ corrections: Correction[] }>("select public.get_sheet_for_correction(300) as v")
			).corrections.map((c) => c.field),
		).toEqual(["first_score", "achievement"]);
	});
});
