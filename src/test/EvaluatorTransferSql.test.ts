import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});

// 期の途中の異動: 社員 4 は一次評価が確定済み、社員 6 は提出済みのところで、一次評価者が 2 から 5 に替わる
it("keeps the primary evaluator of a confirmed primary evaluation, and hands over one still in progress", async () => {
	await db.exec("reset role");
	const [confirmed, inProgress] = (
		await query<{ id: number }>(
			`insert into public.evaluation_sheets (period_id, employee_id, status)
			 values (1, 4, 'first_evaluated'), (1, 6, 'submitted') returning id`,
		)
	).map((sheet) => sheet.id);

	await actAs(db, 1);
	await query("update public.employees set primary_evaluator_id = 5 where id in (4, 6)");

	await db.exec("reset role");
	expect(
		await query(
			"select id, primary_evaluator_id from public.evaluation_sheets where id in ($1, $2) order by id",
			[confirmed, inProgress],
		),
	).toEqual([
		{ id: confirmed, primary_evaluator_id: 2 },
		{ id: inProgress, primary_evaluator_id: 5 },
	]);
	const opens = async (employee: number, sheet: number) => {
		await actAs(db, employee);
		return (await query<{ v: unknown }>("select public.get_sheet($1) as v", [sheet]))[0].v !== null;
	};
	expect(await opens(2, confirmed)).toBe(true);
	expect(await opens(5, confirmed)).toBe(false);
	expect(await opens(2, inProgress)).toBe(false);
	expect(await opens(5, inProgress)).toBe(true);
});

// 社員 6 の前期のシートは 2 が評価して確定した。今の一次評価者は 5
it("lets the current evaluators read an employee's finalized sheets, and nobody else", async () => {
	await db.exec(`reset role;
		update public.employees set primary_evaluator_id = 5 where id = 6;
		alter table public.evaluation_sheets disable trigger user;
		alter table public.milestones disable trigger user;
		insert into public.evaluation_sheets (period_id, employee_id, status, primary_evaluator_id, no_secondary_evaluator, first_overall_comment)
		values (2, 6, 'finalized', 2, true, '前期の総評'), (2, 4, 'submitted', 5, false, '');
		insert into public.milestones (sheet_id, goal_number, challenge_goal, first_score)
		select id, 1, '前期の目標', 3 from public.evaluation_sheets where period_id = 2 and employee_id = 6;
		alter table public.evaluation_sheets enable trigger user;
		alter table public.milestones enable trigger user;`);
	const past = async (employee: number) => {
		await actAs(db, employee);
		const [listed] = await query<{ id: number }>(
			"select id from public.evaluation_sheets where period_id = 2 and employee_id = 6",
		);
		const sheet = listed
			? (
					await query<{ v: { firstOverallComment: string; currentEvaluatorIds: number[] } }>(
						"select public.get_sheet($1) as v",
						[listed.id],
					)
				)[0].v
			: null;
		const goals = await query("select challenge_goal from public.milestones where sheet_id = $1", [
			listed?.id ?? 0,
		]);
		return { listed: Boolean(listed), sheet, goals: goals.length };
	};

	expect(await past(5)).toEqual({
		listed: true,
		sheet: expect.objectContaining({ firstOverallComment: "前期の総評", currentEvaluatorIds: [5] }),
		goals: 1,
	});
	// 評価した人は外れた後も読める。無関係の人は読めない
	expect((await past(2)).listed).toBe(true);
	expect(await past(3)).toEqual({ listed: false, sheet: null, goals: 0 });

	// 読むだけ
	await actAs(db, 5);
	expect(
		await query(
			"update public.milestones set first_score = 1 where challenge_goal = '前期の目標' returning id",
		),
	).toEqual([]);

	// 今の評価者でも、確定前のシートはシートの評価者でなければ読めない(社員 4 の今の二次評価者は 3)
	await actAs(db, 3);
	expect(
		await query("select id from public.evaluation_sheets where period_id = 2 and employee_id = 4"),
	).toEqual([]);
});
