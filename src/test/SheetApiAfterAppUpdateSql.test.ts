import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 202610120010(全員が新しいアプリになった後)を当てた DB。テーブルからは評価を読めず、DB 関数だけが渡す。
// 当てる前の段は SheetApiSql.test.ts。
const DENIED = { code: "42501" };
let db: PGlite;

const sheet = async (viewer: number, id: number) => {
	await actAs(db, viewer);
	return (
		await db.query<{ sheet: { stored: Record<string, number | null> } | null }>(
			"select public.get_sheet($1) as sheet",
			[id],
		)
	).rows[0].sheet;
};
/** 共通評価の全項目を、一次・二次とも score 点・コメント付きで保存しようとする(どちらが入るかはDBが決める)。 */
const save = (sheetId: number, score: number, items = [1, 2]) =>
	db.query("select public.save_common_evaluation($1, $2::jsonb)", [
		sheetId,
		JSON.stringify(
			items.map((itemId) => ({
				itemId,
				firstScore: score,
				secondScore: score,
				firstComment: "所見",
			})),
		),
	]);

beforeAll(async () => {
	db = await createProdLikeDb("202610120010_z");
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("no longer hands out the SMTP account or the evaluations in the tables", async () => {
	await actAs(db, 3);
	await expect(db.query("select public.get_notification_smtp_settings()")).rejects.toMatchObject({
		code: "42883",
	});
	for (const table of ["evaluation_sheets", "milestones", "common_evaluation_results"]) {
		await expect(db.query(`select * from public.${table}`), table).rejects.toMatchObject(DENIED);
	}
	await expect(
		db.query("select first_overall_comment from public.evaluation_sheets"),
	).rejects.toMatchObject(DENIED);
	await expect(db.query("select second_score from public.milestones")).rejects.toMatchObject(
		DENIED,
	);
	await expect(
		db.query("update public.common_evaluation_results set second_score = 4"),
	).rejects.toMatchObject(DENIED);
});

it("still lets the app list, create, fill, evaluate and finalize a sheet", async () => {
	await actAs(db, 4);
	const sheetId = (
		await db.query<{ id: number }>(
			`insert into public.evaluation_sheets (period_id, employee_id) values (1, 4)
			 on conflict (period_id, employee_id) do update set period_id = excluded.period_id, employee_id = excluded.employee_id
			 returning id`,
		)
	).rows[0].id;
	const goal = await db.query<{ id: number }>(
		`insert into public.milestones (sheet_id, goal_number, challenge_goal, midterm_goal, achievement)
		 values ($1, 1, '目標', '', '')
		 on conflict (sheet_id, goal_number) do update set challenge_goal = excluded.challenge_goal
		 returning id`,
		[sheetId],
	);
	await db.query(
		"update public.milestones set challenge_goal = '書き直し' where id = $1 returning id",
		[goal.rows[0].id],
	);
	await db.query("update public.evaluation_sheets set status = 'submitted' where id = $1", [
		sheetId,
	]);
	expect(
		(
			await db.query(
				"select id, period_id, employee_id, status, total_score, created_at, updated_at from public.evaluation_sheets where employee_id = 4",
			)
		).rows,
	).toHaveLength(1);

	await actAs(db, 2);
	await db.query("update public.milestones set first_score = 4 where id = $1 returning id", [
		goal.rows[0].id,
	]);
	await save(sheetId, 4);
	await db.query(
		"update public.evaluation_sheets set objectives_first_total_score = 4, first_overall_comment = '総評' where id = $1",
		[sheetId],
	);
	await db.query(
		"update public.evaluation_sheets set status = 'first_evaluated', first_rank = 'S' where id = $1",
		[sheetId],
	);

	await actAs(db, 3);
	await db.query("update public.milestones set second_score = 4 where id = $1 returning id", [
		goal.rows[0].id,
	]);
	await save(sheetId, 4);
	await db.query(
		"update public.evaluation_sheets set total_evaluation_score = 100, objective_allocation = 20, common_allocation = 80 where id = $1",
		[sheetId],
	);
	await db.query(
		"update public.evaluation_sheets set status = 'finalized', final_rank_letter = 'S', final_rank_level = 'none' where id = $1",
		[sheetId],
	);
	expect((await sheet(4, sheetId))?.stored).toMatchObject({ totalEvaluationScore: 100 });
});
