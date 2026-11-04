import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 業務のきまり: 本人は、締めた評価期間の自分のシートについてだけ、最終評価ランク(グレード)を一覧で見られる。
// 点数・評価点は見られない。締めた評価期間の自分のシートは開けない(目標も含めて、本人には返さない)。
// 評価者は、締めた評価期間のシートを今までどおり読める。前期の目標の引き継ぎも今までどおり。
//
// 期間 1 が実施中、2 が締め済み。社員 4(一次 2・二次 3):
//   300 締め済み・評価確定(A+)   301 実施中・評価確定(B)
// 社員 5: 302 締め済み・評価確定(S)  社員 6: 303 締め済み・一次評価待ちのまま(ランクなし)
// 社員 4 の実施中の下書き 304 は、締めた 300 の目標を前期の目標として読む。

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const grades = async (viewer: number) => {
	await actAs(db, viewer);
	return (await query<{ v: unknown }>("select public.get_my_closed_grades() as v"))[0].v;
};

beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`
		set session_replication_role = replica;
		update public.evaluation_periods set closed_at = now() where id = 2;
		insert into public.evaluation_sheets (id, period_id, employee_id, primary_evaluator_id, secondary_evaluator_id,
			status, final_rank_letter, final_rank_level, total_evaluation_score)
		values
			(300, 2, 4, 2, 3, 'finalized', 'A', 'plus', 92),
			(301, 1, 4, 2, 3, 'finalized', 'B', 'none', 70),
			(302, 2, 5, 2, 3, 'finalized', 'S', 'none', 98),
			(303, 2, 6, 2, null, 'submitted', null, null, null),
			(304, 1, 7, 2, 3, 'draft', null, null, null);
		delete from public.evaluation_sheets where id = 301;
		update public.evaluation_sheets set employee_id = 4, period_id = 1 where id = 304;
		insert into public.evaluation_sheets (id, period_id, employee_id, primary_evaluator_id, secondary_evaluator_id,
			status, final_rank_letter, final_rank_level, total_evaluation_score)
		values (301, 1, 5, 2, 3, 'finalized', 'B', 'none', 70);
		insert into public.milestones (sheet_id, goal_number, challenge_goal, first_score)
		values (300, 1, '前期の目標', 3), (304, 1, '', 0);
		set session_replication_role = origin;
	`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

describe("the grade of one's own closed sheet", () => {
	it("returns only the person's own final rank, only for finalized sheets of closed periods, with no points", async () => {
		expect(await grades(4)).toEqual([{ sheetId: 300, rank: "A+" }]);
		// 実施中の期間の確定済みシート(301)は出さない。締めた期間でも、確定していないシート(303)は出さない
		expect(await grades(5)).toEqual([{ sheetId: 302, rank: "S" }]);
		expect(await grades(6)).toEqual([]);
	});

	it("never returns someone else's grade, not even to their evaluators", async () => {
		expect(await grades(2)).toEqual([]);
		expect(await grades(3)).toEqual([]);
		expect(await grades(7)).toEqual([]);
	});

	it("is not callable without signing in", async () => {
		await actAs(db, 0);
		await expect(query("select public.get_my_closed_grades()")).rejects.toMatchObject({
			code: "42501",
		});
	});
});

describe("one's own sheet of a closed period no longer opens", () => {
	it("returns no closed sheet to the person evaluated, but still the one in progress", async () => {
		await actAs(db, 4);
		expect((await query<{ v: unknown }>("select public.get_sheet(300) as v"))[0].v).toBeNull();
		expect((await query<{ v: unknown }>("select public.get_sheet(304) as v"))[0].v).not.toBeNull();
	});

	it("refuses the goals of a closed sheet read straight from the table", async () => {
		await actAs(db, 4);
		expect(
			await query("select challenge_goal from public.milestones where sheet_id = 300"),
		).toEqual([]);
		// 一覧に出すため、シートの行(状態と評価期間)は読める
		expect(await query("select id, status from public.evaluation_sheets where id = 300")).toEqual([
			{ id: 300, status: "finalized" },
		]);
	});

	it("still lets the evaluators read the closed sheet", async () => {
		for (const evaluator of [2, 3]) {
			await actAs(db, evaluator);
			expect(
				(await query<{ v: { objectives: unknown[] } }>("select public.get_sheet(300) as v"))[0].v
					.objectives,
			).toHaveLength(1);
		}
	});

	it("still offers the closed sheet's challenge goals to carry over into the new period", async () => {
		await actAs(db, 4);
		const [{ v }] = await query<{ v: { goals: { challengeGoal: string }[] } | null }>(
			"select public.get_previous_goals(304) as v",
		);
		expect(v?.goals.map((goal) => goal.challengeGoal)).toEqual(["前期の目標"]);
	});
});
