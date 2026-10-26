import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, applyMigrations, createProdLikeDb } from "./prodLikeDb";

// 期間 2(締め済み)が期間 1(実施中)の前期。社員 4 の前期のシート 100 に目標が2つある。
// チャレンジ目標は据え置く・見直して引き継げ、期中目標と達成状況は今期の分を書く(202610230007)。
let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
	(await db.query<T>(sql, args)).rows;
const value = async <T>(sql: string, args: unknown[] = []) =>
	(await query<{ v: T }>(`select ${sql} as v`, args))[0].v;
const carry = (sheet: number, goal: number) =>
	value<number>("public.carry_over_goal($1,$2)", [sheet, goal]);
const transition = (sheet: number, status: string) =>
	value("public.transition_evaluation_sheet($1,$2)", [sheet, status]);
const goals = async (sheet: number) => {
	await db.exec("reset role");
	return query<{
		goal_number: number;
		challenge_goal: string;
		period_goals: unknown;
		achievement: string;
		carried_from_id: number | null;
	}>(
		"select goal_number, challenge_goal, period_goals, achievement, carried_from_id from public.milestones where sheet_id=$1 order by goal_number",
		[sheet],
	);
};
const previousGoals = (sheet: number) =>
	value<{ goals: { id: number; carriedInto: number | null }[] } | null>(
		"public.get_previous_goals($1)",
		[sheet],
	);

beforeAll(async () => {
	db = await createProdLikeDb("202610230006_z");
	await db.exec(`reset role; set session_replication_role=replica;
		insert into public.evaluation_sheets(id,period_id,employee_id,status,primary_evaluator_id,secondary_evaluator_id)
		values(100,2,4,'finalized',2,3),(200,2,6,'finalized',2,null);
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal,period_goals,achievement)
		values(100,100,1,'受注の手戻りを減らす','[{"description":"手順書","achievement":"作成した"}]',''),
		      (101,100,2,'後進を育てる','[]','2人が独り立ち'),
		      (200,200,1,'別の人の目標','[]','');
		set session_replication_role=origin;`);
	await applyMigrations(
		db,
		(file) => file.startsWith("202610230007_") || file.startsWith("202610260003_"),
	);
}, 60_000);
beforeEach(async () => {
	await db.exec("reset role; delete from public.evaluation_sheets where period_id=1");
});
afterAll(async () => {
	await db?.close();
});

async function draft(): Promise<number> {
	await actAs(db, 4);
	const [{ id }] = await query<{ id: number }>(
		"insert into public.evaluation_sheets(period_id,employee_id) values(1,4) returning id",
	);
	return id;
}

it("copies only the challenge wording, keeps the link, and leaves this period's plan empty", async () => {
	const id = await draft();
	expect(await carry(id, 100)).toBe(1);
	expect(await goals(id)).toEqual([
		{
			goal_number: 1,
			challenge_goal: "受注の手戻りを減らす",
			period_goals: [],
			achievement: "",
			carried_from_id: 100,
		},
	]);
	await actAs(db, 4);
	expect((await previousGoals(id))?.goals).toEqual([
		expect.objectContaining({ id: 100, carriedInto: 1 }),
		expect.objectContaining({ id: 101, carriedInto: null }),
	]);
});

it("keeps the previous goal number, whichever goal is carried first, and revising the wording keeps the link", async () => {
	const id = await draft();
	// 新しいシートには、何も書いていない目標 1 がある
	await query(
		"insert into public.milestones(sheet_id,goal_number,challenge_goal) values($1,1,''),($1,3,'今期の新しい目標')",
		[id],
	);
	// 前期の目標 2 を先に引き継いでも、空の目標 1 には入らず目標 2 のまま
	expect(await carry(id, 101)).toBe(2);
	expect(await carry(id, 100)).toBe(1);
	await actAs(db, 4);
	await query(
		"update public.milestones set challenge_goal='受注の手戻りを、今期は半分に' where sheet_id=$1 and goal_number=1",
		[id],
	);
	expect((await goals(id)).map((goal) => [goal.goal_number, goal.carried_from_id])).toEqual([
		[1, 100],
		[2, 101],
		[3, null],
	]);
	// 引き継いだ目標を消すと、また選べる
	await actAs(db, 4);
	await query("delete from public.milestones where sheet_id=$1 and goal_number=2", [id]);
	expect((await previousGoals(id))?.goals.map((goal) => goal.carriedInto)).toEqual([1, null]);
	expect(await carry(id, 101)).toBe(2);
});

it("uses an empty goal, then the smallest free number, only when the same number is taken", async () => {
	const id = await draft();
	await actAs(db, 4);
	await query(
		"insert into public.milestones(sheet_id,goal_number,challenge_goal) values($1,1,'今期の目標A'),($1,2,'今期の目標B'),($1,4,'')",
		[id],
	);
	// 目標 1 は今期の目標で埋まっているので、何も書いていない目標 4 へ
	expect(await carry(id, 100)).toBe(4);
	// 目標 2 も埋まっていて、空の目標も無いので、空いている番号 3 へ
	expect(await carry(id, 101)).toBe(3);
	expect((await goals(id)).map((goal) => [goal.goal_number, goal.carried_from_id])).toEqual([
		[1, null],
		[2, null],
		[3, 101],
		[4, 100],
	]);
});

it("refuses a second carry, someone else's goal, a full sheet, and anyone but the subject's draft", async () => {
	const id = await draft();
	await carry(id, 100);
	await expect(carry(id, 100)).rejects.toMatchObject({ code: "23505" });
	await expect(carry(id, 200)).rejects.toMatchObject({ code: "P0002" });
	const current = (await goals(id))[0];
	await actAs(db, 4);
	const [{ id: currentGoal }] = await query<{ id: number }>(
		"select id from public.milestones where sheet_id=$1",
		[id],
	);
	expect(current.goal_number).toBe(1);
	await expect(carry(id, currentGoal)).rejects.toMatchObject({ code: "P0002" });
	for (const actor of [2, 3, 5]) {
		await actAs(db, actor);
		await expect(carry(id, 101)).rejects.toMatchObject({ code: "42501" });
	}
	await actAs(db, 4);
	await query(
		"insert into public.milestones(sheet_id,goal_number,challenge_goal) values($1,2,'b'),($1,3,'c'),($1,4,'d')",
		[id],
	);
	await expect(carry(id, 101)).rejects.toMatchObject({ code: "23514" });
	await query("delete from public.milestones where sheet_id=$1 and goal_number=4", [id]);
	await transition(id, "goals_submitted");
	await expect(carry(id, 101)).rejects.toMatchObject({ code: "42501" });
	expect(await goals(id)).toHaveLength(3);
});

it("never lets the app write the link itself", async () => {
	const id = await draft();
	await expect(
		query(
			"insert into public.milestones(sheet_id,goal_number,challenge_goal,carried_from_id) values($1,1,'x',100)",
			[id],
		),
	).rejects.toMatchObject({ code: "42501" });
	await carry(id, 100);
	await actAs(db, 4);
	await expect(
		query("update public.milestones set carried_from_id=101 where sheet_id=$1", [id]),
	).rejects.toMatchObject({ code: "42501" });
});

it("lets the subject rewrite achievements while the goals are under review, but not the plan", async () => {
	const id = await draft();
	await query(
		`insert into public.milestones(sheet_id,goal_number,challenge_goal,period_goals) values($1,1,'テーマ','[{"description":"手順書","achievement":""}]'),($1,2,'テーマ2','[]')`,
		[id],
	);
	await transition(id, "goals_submitted");
	expect(
		await query(
			`update public.milestones set period_goals='[{"description":"手順書","achievement":"半分できた"}]' where sheet_id=$1 and goal_number=1 returning goal_number`,
			[id],
		),
	).toEqual([{ goal_number: 1 }]);
	expect(
		await query(
			"update public.milestones set achievement='テーマ2の実績' where sheet_id=$1 and goal_number=2 returning goal_number",
			[id],
		),
	).toEqual([{ goal_number: 2 }]);
	for (const change of [
		`period_goals='[{"description":"書き換え","achievement":""}]'`,
		`period_goals='[]'`,
		"challenge_goal='別のテーマ'",
	]) {
		await expect(
			query(`update public.milestones set ${change} where sheet_id=$1 and goal_number=1`, [id]),
		).rejects.toMatchObject({ code: "42501" });
	}
	// 一次評価者は、確認中の目標の達成状況を書けない
	await actAs(db, 2);
	expect(
		await query(
			"update public.milestones set achievement='x' where sheet_id=$1 and goal_number=2 returning goal_number",
			[id],
		),
	).toEqual([]);
	// 要修正で戻れば、計画も直せる
	await transition(id, "draft");
	await actAs(db, 4);
	await query(
		`update public.milestones set period_goals='[{"description":"直した手順","achievement":"半分できた"}]' where sheet_id=$1 and goal_number=1`,
		[id],
	);
	expect((await goals(id))[0].period_goals).toEqual([
		{ description: "直した手順", achievement: "半分できた" },
	]);
});
