import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, applyMigrations, createProdLikeDb } from "./prodLikeDb";

// 達成状況は、期中目標があればタスクごとに、無ければチャレンジ目標の achievement に書く(202610230006)。
let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
	(await db.query<T>(sql, args)).rows;
const task = (description: string, achievement = "") => ({ description, achievement });
const row = async (id: number) =>
	(
		await query<{ period_goals: unknown; achievement: string }>(
			"select period_goals, achievement from public.milestones where id=$1",
			[id],
		)
	)[0];

beforeAll(async () => {
	db = await createProdLikeDb("202610230005_z");
	// 制約の前に書かれた、両方に達成状況がある行
	await db.exec(`reset role; set session_replication_role=replica;
		insert into public.evaluation_sheets(id,period_id,employee_id,status,primary_evaluator_id,secondary_evaluator_id)
		values(100,2,4,'finalized',2,3),(101,1,4,'draft',2,3);
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal,period_goals,achievement)
		values(100,100,1,'旧','[{"description":"a","achievement":"タスクの実績"}]','テーマの実績'),
		      (101,100,2,'旧','[{"description":"a","achievement":""}]','テーマの実績'),
		      (200,101,1,'今期','[]','テーマの実績');
		set session_replication_role=origin;`);
	await applyMigrations(db, (file) => file.startsWith("202610230006_"));
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("moves an achievement written on both sides into the first task, without dropping either", async () => {
	await db.exec("reset role");
	expect(await row(100)).toEqual({
		period_goals: [task("a", "タスクの実績\nテーマの実績")],
		achievement: "",
	});
	expect(await row(101)).toEqual({ period_goals: [task("a", "テーマの実績")], achievement: "" });
});

it("rejects a write that leaves an achievement on both sides", async () => {
	await actAs(db, 4);
	await expect(
		query("update public.milestones set period_goals=$2 where id=$1", [
			200,
			JSON.stringify([task("追加")]),
		]),
	).rejects.toMatchObject({ code: "23514" });
	await expect(
		query(
			"insert into public.milestones(sheet_id,goal_number,challenge_goal,period_goals,achievement) values(101,2,'x',$1,'実績')",
			[JSON.stringify([task("a")])],
		),
	).rejects.toMatchObject({ code: "23514" });
	expect(await row(200)).toEqual({ period_goals: [], achievement: "テーマの実績" });

	// 同じ更新で移せば通る
	await query("update public.milestones set period_goals=$2, achievement='' where id=$1", [
		200,
		JSON.stringify([task("追加", "テーマの実績")]),
	]);
	expect(await row(200)).toEqual({
		period_goals: [task("追加", "テーマの実績")],
		achievement: "",
	});
});

it("checks a correction after all of its changes, so moving the achievement in one request works", async () => {
	await db.exec(`reset role; set session_replication_role=replica;
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal,period_goals,achievement)
		values(102,100,3,'旧','[]','テーマ');
		set session_replication_role=origin;`);
	await actAs(db, 1);
	const correct = (changes: unknown[]) =>
		query("select public.correct_closed_sheet(100,$1,'訂正')", [JSON.stringify(changes)]);
	await expect(
		correct([
			{ target: "goal", targetId: 102, field: "period_goals", value: JSON.stringify([task("b")]) },
		]),
	).rejects.toMatchObject({ code: "23514" });
	await correct([
		{
			target: "goal",
			targetId: 102,
			field: "period_goals",
			value: JSON.stringify([task("b", "テーマ")]),
		},
		{ target: "goal", targetId: 102, field: "achievement", value: "" },
	]);
	await db.exec("reset role");
	expect(await row(102)).toEqual({ period_goals: [task("b", "テーマ")], achievement: "" });
});
