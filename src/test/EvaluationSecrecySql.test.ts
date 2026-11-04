import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 業務のきまり: 評価の内容(点数・コメント・総評・ランク・評価点)は、本人には一切見せない(評価確定の後も)。
// 最終評価(二次評価・最終ランク・評価点)を見られるのは、最終評価者と管理者だけ。
// 一次評価者は、自分の一次評価だけを見られる。異動後の今の評価者は、シートの評価者でなければ評価を見られない。
//
// シート 500(評価確定): 本人 4・一次評価者 2・二次評価者 3。社員 4 の今の一次評価者は 5(異動した後)。
// シート 600(評価確定): 本人 6・一次評価者 2・二次評価者「なし」(一次評価者が最終評価者)。

let db: PGlite;
type Sheet = {
	firstOverallComment: string;
	secondOverallComment: string;
	firstRank: string | null;
	finalRankLetter: string | null;
	finalRankLevel: string | null;
	stored: Record<string, unknown>;
	objectives: { challengeGoal: string; firstScore: number; secondScore: number }[];
	commonResults: { firstScore: number; secondScore: number; firstComment: string }[];
	corrections: { field: string }[];
};
const read = async (viewer: number, sheetId = 500) => {
	await actAs(db, viewer);
	const { rows } = await db.query<{ sheet: Sheet | null }>("select public.get_sheet($1) as sheet", [
		sheetId,
	]);
	return rows[0].sheet;
};
const evaluation = (sheet: Sheet | null) =>
	sheet && {
		goal: sheet.objectives[0] && {
			first: sheet.objectives[0].firstScore,
			second: sheet.objectives[0].secondScore,
		},
		common: sheet.commonResults.find(
			(result) => result.firstScore || result.firstComment || result.secondScore,
		)
			? "visible"
			: "hidden",
		firstComment: sheet.commonResults.some((result) => result.firstComment !== ""),
		firstOverall: sheet.firstOverallComment,
		secondOverall: sheet.secondOverallComment,
		firstRank: sheet.firstRank,
		finalRank: sheet.finalRankLetter,
		stored: Object.keys(sheet.stored).length > 0,
		corrections: sheet.corrections.map((correction) => correction.field).sort(),
	};
const NOTHING = {
	goal: { first: 0, second: 0 },
	common: "hidden",
	firstComment: false,
	firstOverall: "",
	secondOverall: "",
	firstRank: null,
	finalRank: null,
	stored: false,
	corrections: ["challenge_goal"],
};
const EVERYTHING = {
	goal: { first: 3, second: 2 },
	common: "visible",
	firstComment: true,
	firstOverall: "一次の総評",
	secondOverall: "二次の総評",
	firstRank: "B",
	finalRank: "A",
	stored: true,
	corrections: ["challenge_goal", "first_score", "second_score"],
};

beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`
		set session_replication_role = replica;
		update public.employees set primary_evaluator_id = 5 where id = 4;
		insert into public.evaluation_sheets (id, period_id, employee_id, primary_evaluator_id, secondary_evaluator_id,
			no_secondary_evaluator, status, grade_id, first_overall_comment, second_overall_comment, first_rank,
			final_rank_letter, final_rank_level, total_evaluation_score, objectives_first_total_score)
		values
			(500, 1, 4, 2, 3, false, 'finalized', 1, '一次の総評', '二次の総評', 'B', 'A', 'none', 90, 3),
			(600, 1, 6, 2, null, true, 'finalized', 1, '一次の総評', '', 'B', 'B', 'plus', 82, 3);
		insert into public.milestones (sheet_id, goal_number, challenge_goal, first_score, second_score)
		values (500, 1, '目標', 3, 2), (600, 1, '目標', 3, 0);
		insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
		select sheet_id, item.id, 3, case when sheet_id = 500 then 2 else 0 end, '一次のコメント'
		from (values (500), (600)) as sheets(sheet_id)
		cross join (select id from public.common_evaluation_items where item_set_id = 1 or item_set_id is null) as item;
		insert into public.sheet_corrections (sheet_id, target, goal_number, field, before_value, after_value, reason)
		values
			(500, 'goal', 1, 'challenge_goal', '前', '目標', '誤字'),
			(500, 'goal', 1, 'first_score', '2', '3', '一次の誤り'),
			(500, 'goal', 1, 'second_score', '1', '2', '二次の誤り');
		set session_replication_role = origin;
	`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

describe("a finalized sheet keeps its evaluation from the person evaluated", () => {
	it("returns the goals but no score, comment, rank, total or evaluation correction to the person evaluated", async () => {
		const sheet = await read(4);
		expect(sheet?.objectives[0].challengeGoal).toBe("目標");
		expect(evaluation(sheet)).toEqual(NOTHING);
		expect(evaluation(await read(6, 600))).toEqual({ ...NOTHING, corrections: [] });
	});

	it("shows the primary evaluator only their own primary evaluation, never the final result", async () => {
		expect(evaluation(await read(2))).toEqual({
			goal: { first: 3, second: 0 },
			common: "visible",
			firstComment: true,
			firstOverall: "一次の総評",
			secondOverall: "",
			firstRank: "B",
			finalRank: null,
			stored: false,
			corrections: ["challenge_goal", "first_score"],
		});
	});

	it("shows the final evaluator and an Admin everything", async () => {
		expect(evaluation(await read(3))).toEqual(EVERYTHING);
		expect(evaluation(await read(1))).toEqual(EVERYTHING);
	});

	it("shows a primary evaluator who is also the final evaluator the final result", async () => {
		expect(evaluation(await read(2, 600))).toMatchObject({
			goal: { first: 3, second: 0 },
			firstOverall: "一次の総評",
			firstRank: "B",
			finalRank: "B",
			stored: true,
		});
	});

	it("shows the current evaluator after a transfer the goals, but no evaluation", async () => {
		const sheet = await read(5);
		expect(sheet?.objectives[0].challengeGoal).toBe("目標");
		expect(evaluation(sheet)).toEqual(NOTHING);
	});

	it("gives nothing to someone unrelated", async () => {
		expect(await read(7)).toBeNull();
	});
});

describe("the person evaluated cannot read the evaluation from the tables either", () => {
	it.each([
		"select first_score from public.milestones where sheet_id = 500",
		"select second_score from public.milestones where sheet_id = 500",
		"select final_rank_letter from public.evaluation_sheets where id = 500",
		"select total_evaluation_score from public.evaluation_sheets where id = 500",
		"select first_overall_comment from public.evaluation_sheets where id = 500",
		"select first_score from public.common_evaluation_results where sheet_id = 500",
		"select after_value from public.sheet_corrections where sheet_id = 500",
	])("refuses %s", async (sql) => {
		await actAs(db, 4);
		await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
	});

	it("lists the person evaluated in no row policy for evaluation results", async () => {
		await db.exec("reset role");
		const { rows } = await db.query<{ qual: string }>(
			"select qual from pg_policies where schemaname = 'public' and tablename = 'common_evaluation_results' and cmd = 'SELECT'",
		);
		for (const { qual } of rows) {
			expect(qual).not.toContain("subject");
		}
	});
});
