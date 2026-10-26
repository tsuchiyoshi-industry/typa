import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, applyMigrations, createProdLikeDb, uid } from "./prodLikeDb";

let db: PGlite;
let legacyStatus: string;
const tasks = Array.from({ length: 4 }, (_, i) => ({
	description: `タスク${i + 1}`,
	achievement: "",
}));
const query = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
	(await db.query<T>(sql, args)).rows;
const value = async <T>(sql: string, args: unknown[] = []) =>
	(await query<{ v: T }>(`select ${sql} as v`, args))[0].v;
const transition = (sheet: number, status: string) =>
	value("public.transition_evaluation_sheet($1,$2)", [sheet, status]);
const state = (sheet: number) =>
	value<string>("(select status from public.evaluation_sheets where id=$1)", [sheet]);
const document = (sheet: number) =>
	value<{ objectives: { id: number; achievement: string; periodGoals: typeof tasks }[] }>(
		"public.get_sheet($1)",
		[sheet],
	);

beforeAll(async () => {
	db = await createProdLikeDb("202610230004_z");
	await db.exec(`set session_replication_role=replica;
		insert into public.evaluation_sheets(id,period_id,employee_id,status,primary_evaluator_id,secondary_evaluator_id)
		values(100,2,4,'finalized',2,3),(101,1,6,'submitted',2,null);
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal,period_goals)
		values(100,100,1,'旧目標','[{"description":"","achievement":"既存の実績"}]');
		set session_replication_role=origin;`);
	await applyMigrations(db, (file) => file.startsWith("202610230005_"));
	legacyStatus = await state(101);
}, 60_000);
beforeEach(async () => {
	await db.exec("reset role; delete from public.evaluation_sheets where period_id=1");
});
afterAll(async () => {
	await db?.close();
});

async function draft(goals: typeof tasks = [], employee = 4): Promise<number> {
	await actAs(db, employee);
	const [{ id }] = await query<{ id: number }>(
		"insert into public.evaluation_sheets(period_id,employee_id) values(1,$1) returning id",
		[employee],
	);
	await query(
		"insert into public.milestones(sheet_id,goal_number,challenge_goal,period_goals) values($1,1,'テーマ',$2)",
		[id, JSON.stringify(goals)],
	);
	return id;
}
async function confirmed(goals: typeof tasks = [], employee = 4): Promise<number> {
	const id = await draft(goals, employee);
	await transition(id, "goals_submitted");
	await actAs(db, 2);
	await transition(id, "goals_confirmed");
	await actAs(db, employee);
	return id;
}

it("keeps historical evaluation stages and migrates an empty task's achievement to its challenge", async () => {
	expect(legacyStatus).toBe("submitted");
	await actAs(db, 4);
	expect((await document(100)).objectives[0]).toMatchObject({
		periodGoals: [],
		achievement: "既存の実績",
	});
});

it("accepts zero through four tasks and rejects five, malformed entries and completion flags", async () => {
	const id = await draft();
	expect((await document(id)).objectives[0].periodGoals).toEqual([]);
	for (let count = 1; count <= 4; count++) {
		await query("update public.milestones set period_goals=$2 where sheet_id=$1", [
			id,
			JSON.stringify(tasks.slice(0, count)),
		]);
	}
	for (const invalid of [
		[...tasks, tasks[0]],
		[null],
		[1],
		{},
		[{ description: "x", achievement: "", done: true }],
	]) {
		await expect(
			query("update public.milestones set period_goals=$2 where sheet_id=$1", [
				id,
				JSON.stringify(invalid),
			]),
		).rejects.toMatchObject({ code: "23514" });
	}
});

it("allows only the subject to send goals and only the primary evaluator to return or confirm them", async () => {
	const id = await draft();
	await expect(transition(id, "submitted")).rejects.toMatchObject({ code: "42501" });
	await expect(
		query("update public.evaluation_sheets set status='submitted' where id=$1", [id]),
	).rejects.toMatchObject({ code: "42501" });
	await transition(id, "goals_submitted");
	for (const employee of [4, 3, 5, 1]) {
		await actAs(db, employee);
		for (const next of ["draft", "goals_confirmed", "submitted"]) {
			await expect(transition(id, next)).rejects.toMatchObject({ code: "42501" });
		}
	}
	await actAs(db, 2);
	await transition(id, "draft");
	await actAs(db, 4);
	await query("update public.milestones set challenge_goal='修正したテーマ' where sheet_id=$1", [
		id,
	]);
	await transition(id, "goals_submitted");
	await actAs(db, 2);
	await transition(id, "goals_confirmed");
	expect(await state(id)).toBe("goals_confirmed");
});

it("locks all content while goals are sent and disallows scoring in either pre-evaluation stage", async () => {
	const id = await draft(tasks);
	await transition(id, "goals_submitted");
	await expect(
		query("update public.milestones set period_goals=$2 where sheet_id=$1 returning id", [
			id,
			JSON.stringify(tasks.map((item) => ({ ...item, achievement: "追記" }))),
		]),
	).resolves.toEqual([]);
	for (const stage of ["goals_submitted", "goals_confirmed"]) {
		await actAs(db, 2);
		if (stage === "goals_confirmed") {
			await transition(id, stage);
		}
		await expect(
			query("update public.milestones set first_score=4 where sheet_id=$1 returning id", [id]),
		).resolves.toEqual([]);
		await expect(
			value("public.save_common_evaluation($1,$2)", [
				id,
				JSON.stringify([{ itemId: 1, firstScore: 4 }]),
			]),
		).rejects.toMatchObject({ code: "42501" });
		await expect(transition(id, "first_evaluated")).rejects.toMatchObject({ code: "42501" });
	}
});

it("allows only task achievements after confirmation, preserving task count, text and order", async () => {
	const id = await confirmed(tasks);
	for (const changes of [
		tasks.slice(1),
		[...tasks].reverse(),
		tasks.map((item, i) => (i ? item : { ...item, description: "改変" })),
	]) {
		await expect(
			query("update public.milestones set period_goals=$2 where sheet_id=$1", [
				id,
				JSON.stringify(changes),
			]),
		).rejects.toMatchObject({ code: "42501" });
	}
	await expect(
		query("update public.milestones set challenge_goal='改変' where sheet_id=$1", [id]),
	).rejects.toMatchObject({ code: "42501" });
	await expect(
		query("delete from public.milestones where sheet_id=$1 returning id", [id]),
	).resolves.toEqual([]);
	await expect(
		query(
			"insert into public.milestones(sheet_id,goal_number,challenge_goal) values($1,2,'追加')",
			[id],
		),
	).rejects.toMatchObject({ code: "42501" });
	const result = tasks.map((item, i) => ({ ...item, achievement: i === 3 ? "途中まで実施" : "" }));
	await query("update public.milestones set period_goals=$2 where sheet_id=$1", [
		id,
		JSON.stringify(result),
	]);
	expect((await document(id)).objectives[0].periodGoals).toEqual(result);
	await expect(
		query("update public.milestones set achievement='親への書き込み' where sheet_id=$1", [id]),
	).rejects.toMatchObject({ code: "42501" });
});

it("writes challenge achievement with zero tasks, then locks it when the subject requests evaluation", async () => {
	const id = await confirmed();
	await query("update public.milestones set achievement='テーマに対する実績' where sheet_id=$1", [
		id,
	]);
	expect((await document(id)).objectives[0]).toMatchObject({
		periodGoals: [],
		achievement: "テーマに対する実績",
	});
	await actAs(db, 2);
	await expect(transition(id, "submitted")).rejects.toMatchObject({ code: "42501" });
	await actAs(db, 4);
	await transition(id, "submitted");
	await expect(
		query("update public.milestones set achievement='再編集' where sheet_id=$1 returning id", [id]),
	).resolves.toEqual([]);
	await expect(transition(id, "draft")).rejects.toMatchObject({ code: "42501" });
	await actAs(db, 2);
	await query("update public.milestones set first_score=4 where sheet_id=$1", [id]);
	await value("public.save_common_evaluation($1,$2)", [
		id,
		JSON.stringify([
			{ itemId: 1, firstScore: 4 },
			{ itemId: 2, firstScore: 4 },
		]),
	]);
	await transition(id, "first_evaluated");
	await actAs(db, 3);
	await query("update public.milestones set second_score=4 where sheet_id=$1", [id]);
	await value("public.save_common_evaluation($1,$2)", [
		id,
		JSON.stringify([
			{ itemId: 1, secondScore: 4 },
			{ itemId: 2, secondScore: 4 },
		]),
	]);
	await transition(id, "finalized");
	expect(await state(id)).toBe("finalized");
});

it("routes each pre-evaluation notification to the next actor and never asks for scoring early", async () => {
	const id = await draft();
	await transition(id, "goals_submitted");
	await actAs(db, 2);
	expect(
		await query("select kind from public.notifications where sheet_id=$1 and read_at is null", [
			id,
		]),
	).toEqual([{ kind: "goals_submitted" }]);
	await transition(id, "draft");
	await actAs(db, 4);
	expect(
		await query("select kind from public.notifications where sheet_id=$1 and read_at is null", [
			id,
		]),
	).toEqual([{ kind: "draft" }]);
	await transition(id, "goals_submitted");
	await actAs(db, 2);
	await transition(id, "goals_confirmed");
	await db.exec("reset role");
	expect(
		await value("public.get_sheet_notification($1,$2)->'recipients'->0->>'role'", [id, uid(2)]),
	).toBe("subject");
	await actAs(db, 4);
	expect(
		await query("select kind from public.notifications where sheet_id=$1 and read_at is null", [
			id,
		]),
	).toEqual([{ kind: "goals_confirmed" }]);
	await transition(id, "submitted");
	await actAs(db, 2);
	expect(
		await query("select kind from public.notifications where sheet_id=$1 and read_at is null", [
			id,
		]),
	).toEqual([{ kind: "submitted" }]);
});

it("preserves challenge achievements in correction and previous-period lookup", async () => {
	await actAs(db, 1);
	await value("public.correct_closed_sheet($1,$2,$3)", [
		100,
		JSON.stringify([
			{ target: "goal", targetId: 100, field: "achievement", value: "訂正したテーマ実績" },
		]),
		"実績の訂正",
	]);
	await actAs(db, 4);
	expect((await document(100)).objectives[0]).toMatchObject({
		achievement: "訂正したテーマ実績",
		periodGoals: [],
	});
	const id = await draft();
	const previous = await value<{ goals: { achievement: string; periodGoals: unknown[] }[] }>(
		"public.get_previous_goals($1)",
		[id],
	);
	expect(previous.goals[0]).toMatchObject({ achievement: "訂正したテーマ実績", periodGoals: [] });
});

it("transfers goal review to the new primary evaluator while keeping confirmed goals fixed", async () => {
	const id = await draft();
	await transition(id, "goals_submitted");
	await actAs(db, 1);
	await query("update public.employees set primary_evaluator_id=5 where id=4");
	await actAs(db, 2);
	await expect(transition(id, "goals_confirmed")).rejects.toMatchObject({ code: "42501" });
	expect(
		await query("select kind from public.notifications where sheet_id=$1 and read_at is null", [
			id,
		]),
	).toEqual([]);
	await actAs(db, 5);
	expect(
		await query("select kind from public.notifications where sheet_id=$1 and read_at is null", [
			id,
		]),
	).toEqual([{ kind: "goals_submitted" }]);
	await transition(id, "goals_confirmed");
	await actAs(db, 4);
	expect((await document(id)).objectives[0].periodGoals).toEqual([]);
	await db.exec("reset role; update public.employees set primary_evaluator_id=2 where id=4");
});
