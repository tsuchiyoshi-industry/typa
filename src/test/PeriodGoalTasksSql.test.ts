import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, applyMigrations, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const tasks = [
	{ description: "手順書を作る\n現場で試す", achievement: "試行中" },
	{ description: "研修を開く", achievement: "" },
];
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const document = async (sheet: number) =>
	(
		await rows<{
			value: {
				objectives: { id: number; periodGoals: typeof tasks; firstScore: number }[];
				corrections: { field: string; before: string; after: string }[];
			};
		}>("select public.get_sheet($1) as value", [sheet])
	)[0].value;

beforeAll(async () => {
	db = await createProdLikeDb("202610230003_z");
	await db.exec(`
		set session_replication_role = replica;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, secondary_evaluator_id)
		values (100, 2, 4, 'draft', 2, 3), (101, 2, 6, 'draft', 2, null), (200, 1, 4, 'draft', 2, 3);
		-- シート 101 は締めた後の訂正を確かめる。移行の結果を見るシート 100 は書き換えない
		insert into public.milestones (id, sheet_id, goal_number, challenge_goal, midterm_goal, achievement)
		values (11, 100, 1, '品質改善', E'既存の文章\n改行も保持', '途中まで実施'),
		       (12, 101, 1, '品質改善', E'既存の文章\n改行も保持', '途中まで実施');
		set session_replication_role = origin;
	`);
	await applyMigrations(db, (name) => name.startsWith("202610230004_"));
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("migrates closed sheets without splitting legacy prose, and removes the old scalar columns", async () => {
	await actAs(db, 4);
	expect((await document(100)).objectives[0].periodGoals).toEqual([
		{ description: "既存の文章\n改行も保持", achievement: "途中まで実施" },
	]);
	expect((await document(100)).objectives[0]).not.toHaveProperty("midtermGoal");
	await db.exec("reset role");
	expect(
		await rows(
			"select column_name from information_schema.columns where table_schema = 'public' and table_name = 'milestones' and column_name in ('midterm_goal', 'achievement')",
		),
	).toEqual([]);
});

it("saves multiple tasks with optional free-form achievements as part of their parent challenge", async () => {
	await actAs(db, 4);
	await rows(
		"insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals) values (200, 1, '今期のテーマ', $1) on conflict (sheet_id, goal_number) do update set challenge_goal = excluded.challenge_goal, period_goals = excluded.period_goals returning id",
		[JSON.stringify(tasks)],
	);
	expect((await document(200)).objectives[0].periodGoals).toEqual(tasks);
	await rows("update public.milestones set period_goals = $1 where sheet_id = 200", [
		JSON.stringify([...tasks].reverse()),
	]);
	expect((await document(200)).objectives[0].periodGoals).toEqual([...tasks].reverse());
	await actAs(db, 2);
	expect((await document(200)).objectives).toEqual([]);
	expect(
		await rows("update public.milestones set period_goals = $1 where sheet_id = 200 returning id", [
			JSON.stringify(tasks),
		]),
	).toEqual([]);
});

it.each(
	[[], {}, [{ description: "task" }], [{ description: "task", achievement: "", done: true }]].map(
		(invalid) => ({ invalid }),
	),
)("rejects malformed tasks and completion flags: %j", async ({ invalid }) => {
	await actAs(db, 4);
	// 直す先の目標があること(ほかのテストが作ったものに寄りかからない)
	await rows(
		"insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals) values (200, 1, '今期のテーマ', $1) on conflict (sheet_id, goal_number) do nothing",
		[JSON.stringify(tasks)],
	);
	await expect(
		rows("update public.milestones set period_goals = $1 where sheet_id = 200", [
			JSON.stringify(invalid),
		]),
	).rejects.toMatchObject({ code: "23514" });
});

it("corrects a closed task list atomically and returns a visible history with all task associations", async () => {
	await actAs(db, 1);
	await rows("select public.correct_closed_sheet(101, $1, '記載の訂正')", [
		JSON.stringify([
			{ target: "goal", targetId: 12, field: "period_goals", value: JSON.stringify(tasks) },
		]),
	]);
	await actAs(db, 6);
	const corrected = await document(101);
	expect(corrected.objectives[0].periodGoals).toEqual(tasks);
	expect(corrected.corrections).toHaveLength(1);
	expect(JSON.parse(corrected.corrections[0].before)).toEqual([
		{ description: "既存の文章\n改行も保持", achievement: "途中まで実施" },
	]);
	expect(JSON.parse(corrected.corrections[0].after)).toEqual(tasks);
	await actAs(db, 1);
	await expect(
		rows("select public.correct_closed_sheet(101, $1, '同じ内容')", [
			JSON.stringify([
				{ target: "goal", targetId: 12, field: "period_goals", value: JSON.stringify(tasks) },
			]),
		]),
	).rejects.toThrow("今と同じ内容");
	await actAs(db, 6);
	await expect(
		rows("update public.milestones set period_goals = $1 where id = 12", [JSON.stringify(tasks)]),
	).rejects.toThrow("締められた評価期間");
});
