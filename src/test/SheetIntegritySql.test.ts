import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const rpc = async <T>(sql: string, params: unknown[] = []) =>
	(await query<{ v: T }>(`select ${sql} as v`, params))[0].v;
const transition = (id: number, status: string) =>
	rpc<Record<string, unknown>>("public.transition_evaluation_sheet($1,$2)", [id, status]);
const goals = async (employee: number) => {
	await actAs(db, employee);
	const id = (
		await query<{ id: number }>(
			"insert into public.evaluation_sheets(period_id,employee_id) values(1,$1) returning id",
			[employee],
		)
	)[0].id;
	await query(
		"insert into public.milestones(sheet_id,goal_number,challenge_goal) values($1,1,'目標')",
		[id],
	);
	await transition(id, "goals_submitted");
	await actAs(db, 2);
	await transition(id, "goals_confirmed");
	await actAs(db, employee);
	await transition(id, "submitted");
	await actAs(db, 2);
	await query("update public.milestones set first_score=4 where sheet_id=$1", [id]);
	await rpc("public.save_common_evaluation($1,$2::jsonb)", [
		id,
		JSON.stringify([
			{ itemId: 1, firstScore: 4 },
			{ itemId: 2, firstScore: 4 },
		]),
	]);
	return id;
};
beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("derives every finalized subtotal on the server, including direct legacy API writes", async () => {
	const id = await goals(6);
	await query(
		"update public.evaluation_sheets set objectives_second_total_rate=1, objectives_second_evaluation_score=1, common_evaluation_second_total_rate=1, common_evaluation_second_evaluation_score=1, total_evaluation_score=100, first_rank='S', final_rank_letter='S', final_rank_level='none', status='finalized' where id=$1",
		[id],
	);
	const s = await rpc<{ stored: Record<string, number> }>("public.get_sheet($1)", [id]);
	expect(s.stored).toMatchObject({
		objectivesFirstTotalScore: 4,
		objectivesFirstTotalRate: 100,
		objectivesSecondTotalScore: 4,
		objectivesSecondTotalRate: 100,
		commonEvaluationFirstTotalScore: 20,
		commonEvaluationFirstTotalRate: 100,
		commonEvaluationSecondTotalScore: 20,
		commonEvaluationSecondTotalRate: 100,
		objectivesSecondEvaluationScore: 20,
		commonEvaluationSecondEvaluationScore: 80,
		totalEvaluationScore: 100,
		objectiveAllocation: 20,
		commonAllocation: 80,
	});
});

it("confirms both stages atomically without trusting client ranks or aggregates", async () => {
	const id = await goals(4);
	await actAs(db, 4);
	await expect(transition(id, "finalized")).rejects.toMatchObject({ code: "42501" });
	await actAs(db, 2);
	expect(await transition(id, "first_evaluated")).toMatchObject({
		status: "first_evaluated",
		firstRank: "S",
	});
	await actAs(db, 3);
	await query("update public.milestones set second_score=2 where sheet_id=$1", [id]);
	await rpc("public.save_common_evaluation($1,$2::jsonb)", [
		id,
		JSON.stringify([
			{ itemId: 1, secondScore: 3 },
			{ itemId: 2, secondScore: 3 },
		]),
	]);
	expect(await transition(id, "finalized")).toMatchObject({
		status: "finalized",
		firstRank: "S",
		finalRankLetter: "B",
		finalRankLevel: "none",
		stored: {
			objectivesSecondEvaluationScore: 10,
			commonEvaluationSecondEvaluationScore: 60,
			totalEvaluationScore: 70,
		},
	});
	await expect(
		rpc('public.save_common_evaluation($1,\'[{"itemId":1,"secondScore":4}]\'::jsonb)', [id]),
	).rejects.toMatchObject({ code: "42501" });
});

it("rejects bad batches atomically instead of partially saving known items", async () => {
	await actAs(db, 1);
	await query(
		"update public.employees set primary_evaluator_id=2, no_secondary_evaluator=true where id=5",
	);
	const id = await goals(5);
	for (const bad of [
		[
			{ itemId: 1, firstScore: 1 },
			{ itemId: 999, firstScore: 4 },
		],
		[
			{ itemId: 1, firstScore: 1 },
			{ itemId: 1, firstScore: 4 },
		],
		[{ itemId: 1, firstScore: 5 }],
	]) {
		await expect(
			rpc("public.save_common_evaluation($1,$2::jsonb)", [id, JSON.stringify(bad)]),
		).rejects.toMatchObject({ code: "23514" });
	}
	const s = await rpc<{ commonResults: Array<{ firstScore: number }> }>("public.get_sheet($1)", [
		id,
	]);
	expect(s.commonResults.map((r) => r.firstScore)).toEqual([4, 4]);
});
