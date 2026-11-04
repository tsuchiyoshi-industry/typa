import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb, rollbackAfterTest } from "./prodLikeDb";

// 評価者のシート一覧(FetchCategorizedSheetsInteractor → findByEvaluator)は「自分以外のシート」を
// 行ポリシーに絞らせる。読める範囲は変えずに、行ごとに関数を呼ばない形で絞ることを確かめる。

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
/** アプリの評価者一覧と同じ問い合わせ。 */
const listOf = async (employee: number) => {
	await actAs(db, employee);
	return (
		await query<{ id: number }>(
			"select id from public.evaluation_sheets where employee_id <> $1 order by id",
			[employee],
		)
	).map((sheet) => sheet.id);
};

// 社員 6 の一次評価者は 2 から 5 に替わった(異動)。社員 4 の今の評価者は 2(一次)・3(二次)
//   11: 社員6 締め済み期間 確定     シートの評価者 2           → 2(評価した人)と 5(今の評価者)
//   12: 社員6 実施中期間   提出済み シートの評価者 5           → 5 だけ(確定前は今の評価者でも、シートの評価者だけ)
//   13: 社員4 締め済み期間 確定     シートの評価者 2・3        → 2・3
//   14: 社員4 実施中期間   下書き   シートの評価者 2・3        → 2・3
//   15: 社員4 別の締め済み 一次評価済み シートの評価者 5・1    → 5・1(今の評価者 2・3 には確定前なので見えない)
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`reset role;
		insert into public.evaluation_periods (id, period_name, start_date, end_date, is_active)
		values (3, '前々期', '2025-04-01', '2025-09-30', false);
		alter table public.evaluation_sheets disable trigger user;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator) values
		  (11, 2, 6, 'finalized', 2, null, true),
		  (12, 1, 6, 'submitted', 5, null, true),
		  (13, 2, 4, 'finalized', 2, 3, false),
		  (14, 1, 4, 'draft', 2, 3, false),
		  (15, 3, 4, 'first_evaluated', 5, 1, false);
		alter table public.evaluation_sheets enable trigger user;
		update public.employees set primary_evaluator_id = 5 where id = 6;`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("lists the sheets an evaluator is on, plus the finalized sheets of their current subordinates", async () => {
	expect(await listOf(2)).toEqual([11, 13, 14]);
	expect(await listOf(3)).toEqual([13, 14]);
	expect(await listOf(5)).toEqual([11, 12, 15]);
	expect(await listOf(1)).toEqual([15]);
});

it("lists nothing for the subjects themselves or for an unrelated account", async () => {
	expect(await listOf(4)).toEqual([]);
	expect(await listOf(6)).toEqual([]);
	await actAs(db, 99);
	expect(await query("select id from public.evaluation_sheets")).toEqual([]);
	await actAs(db, 0);
	await expect(query("select id from public.evaluation_sheets")).rejects.toThrow();
});

it("tells a caller only their own current subordinates, and nothing before sign-in", async () => {
	await actAs(db, 2);
	expect(await query("select * from public.current_subordinate_ids() as id order by 1")).toEqual([
		{ id: 4 },
	]);
	await actAs(db, 4);
	expect(await query("select * from public.current_subordinate_ids()")).toEqual([]);
	await actAs(db, 0);
	await expect(query("select * from public.current_subordinate_ids()")).rejects.toThrow(
		/permission denied/,
	);
});

it("lists nothing for a suspended evaluator", async () => {
	await rollbackAfterTest(db);
	await db.exec("reset role; update public.employees set is_enabled = false where id = 5");
	expect(await listOf(5)).toEqual([]);
});

it("follows a transfer at once: the in-progress sheet moves, and the former evaluator loses the finalized history", async () => {
	await rollbackAfterTest(db);
	await db.exec("reset role; update public.employees set primary_evaluator_id = 2 where id = 6");
	// 12 は評価中なので新しい一次評価者に引き継がれる。11 は 5 が評価したシートではない
	expect(await listOf(5)).toEqual([15]);
	expect(await listOf(2)).toEqual([11, 12, 13, 14]);
});

it("does not call a function for every sheet row to find the current subordinates", async () => {
	await actAs(db, 2);
	const plan = (
		await query<{ "QUERY PLAN": string }>(
			"explain (costs off) select id from public.evaluation_sheets where employee_id <> 2",
		)
	)
		.map((line) => line["QUERY PLAN"])
		.join("\n");
	expect(plan).not.toContain("is_current_evaluator_of");
	// 今の部下は一度だけ集めて、行はその集合と照らす
	expect(plan).toMatch(/SubPlan/);
});
