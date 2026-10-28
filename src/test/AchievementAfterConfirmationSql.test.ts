import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 達成状況は、一次評価者が目標を確定してから(振り返り待ち)だけ本人が書ける。API を直接たたいても同じ。
// 社員 4 の一次評価者は 2。このきまりより前に書かれた達成状況は、残すことと消すことだけできる。
let db: PGlite;
const task = (description: string, achievement = "") => ({ description, achievement });
const tasks = (...items: ReturnType<typeof task>[]) => JSON.stringify(items);
const setStatus = (status: string) =>
	db.exec(
		`reset role; set session_replication_role=replica; update public.evaluation_sheets set status='${status}' where id=900; set session_replication_role=origin;`,
	);
const writeTasks = async (json: string) => {
	await actAs(db, 4);
	await db.query("update public.milestones set period_goals=$1::jsonb where sheet_id=900", [json]);
};
const stored = async () => {
	await db.exec("reset role");
	return (
		await db.query<{ goals: unknown }>(
			"select period_goals as goals from public.milestones where sheet_id=900",
		)
	).rows[0].goals;
};

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
beforeEach(async () => {
	await db.exec(`reset role; delete from public.evaluation_sheets where id=900;
		insert into public.evaluation_sheets(id,period_id,employee_id) values(900,1,4);
		insert into public.milestones(sheet_id,goal_number,challenge_goal,period_goals)
		values(900,1,'目標','${tasks(task("手順を見直す"))}');`);
});
afterAll(async () => {
	await db?.close();
});

it.each(["draft", "goals_submitted"])(
	"refuses achievement text while the sheet is %s",
	async (status) => {
		await setStatus(status);
		await expect(writeTasks(tasks(task("手順を見直す", "見直した")))).rejects.toMatchObject({
			code: "42501",
			message: "達成状況は、一次評価者が目標を確定してから書けます。",
		});
		expect(await stored()).toEqual([task("手順を見直す")]);
	},
);

it("refuses a theme achievement on a draft goal without tasks, and on a new goal", async () => {
	await writeTasks("[]");
	await actAs(db, 4);
	await expect(
		db.query("update public.milestones set achievement='テーマの実績' where sheet_id=900"),
	).rejects.toMatchObject({ code: "42501" });
	await expect(
		db.query(
			"insert into public.milestones(sheet_id,goal_number,challenge_goal,achievement) values(900,2,'目標2','新しい実績')",
		),
	).rejects.toMatchObject({ code: "42501" });
});

it("still lets the subject write the goals of a draft", async () => {
	await writeTasks(tasks(task("手順を直す"), task("共有する")));
	expect(await stored()).toEqual([task("手順を直す"), task("共有する")]);
});

it("lets the subject write achievements once the goals are confirmed", async () => {
	await setStatus("goals_confirmed");
	await writeTasks(tasks(task("手順を見直す", "見直した")));
	expect(await stored()).toEqual([task("手順を見直す", "見直した")]);
});

it("keeps or clears an achievement written before this rule, but refuses to change it", async () => {
	await db.exec(
		`update public.milestones set period_goals='${tasks(task("手順を見直す", "以前の実績"), task("共有する"))}' where sheet_id=900`,
	);
	await writeTasks(tasks(task("手順を直す", "以前の実績"), task("共有する")));
	await writeTasks(tasks(task("共有する"), task("手順を直す", "以前の実績")));
	await expect(
		writeTasks(tasks(task("共有する"), task("手順を直す", "以前の実績に追記"))),
	).rejects.toMatchObject({
		code: "42501",
	});
	await writeTasks(tasks(task("共有する"), task("手順を直す")));
	expect(await stored()).toEqual([task("共有する"), task("手順を直す")]);
});

it("does not stop the Admin import, which records past achievements on purpose", async () => {
	await actAs(db, 1);
	const result = await db.query<{ v: { applied: boolean; errors: unknown[] } }>(
		"select public.import_sheet_data($1::jsonb,'[]'::jsonb,true) as v",
		[
			JSON.stringify([
				{
					line: 2,
					employeeNo: "E4",
					name: "",
					goalNumber: "1",
					challengeGoal: "取り込んだ目標",
					periodGoals: [],
					achievement: "過去の実績",
					firstScore: "",
					secondScore: "",
				},
			]),
		],
	);
	expect(result.rows[0].v).toMatchObject({ applied: true, errors: [] });
	await db.exec("reset role");
	expect(
		(
			await db.query<{ a: string }>(
				"select achievement as a from public.milestones where sheet_id=900",
			)
		).rows[0]?.a,
	).toBe("過去の実績");
});
