import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []) =>
	(await query<{ v: T }>(sql, params))[0].v;
type Previous = {
	periodName: string;
	goals: { id: number; goalNumber: number; challengeGoal: string; carried: boolean }[];
} | null;
const previousGoals = (sheet: number) =>
	one<Previous>("select public.get_previous_goals($1) as v", [sheet]);

// 社員 4(一次 2・二次 3): 締めた期間 2 に下書きのまま締めたシート 100(目標2件)、実施中の期間 1 に下書き 200
let previousIds: number[] = [];
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`
		reset role;
		set session_replication_role = replica;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, secondary_evaluator_id)
		values (100, 2, 4, 'draft', 2, 3), (200, 1, 4, 'draft', 2, 3);
		insert into public.milestones (sheet_id, goal_number, challenge_goal, achievement)
		values (100, 1, '前期の目標1', '達成した'), (100, 2, '前期の目標2', '');
		set session_replication_role = origin;
	`);
	previousIds = (
		await query<{ id: number }>(
			"select id from public.milestones where sheet_id = 100 order by goal_number",
		)
	).map((row) => row.id);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("shows the subject the goals of the previous period and carries one over into the draft", async () => {
	await actAs(db, 4);
	expect(await previousGoals(200)).toMatchObject({
		periodName: "締め済み",
		goals: [
			{ goalNumber: 1, challengeGoal: "前期の目標1", carried: false },
			{ goalNumber: 2, challengeGoal: "前期の目標2", carried: false },
		],
	});

	await query("select public.carry_over_goal(200, $1)", [previousIds[0]]);
	await db.exec("reset role");
	expect(
		await query(
			"select goal_number, challenge_goal, midterm_goal, carried_from_id from public.milestones where sheet_id = 200",
		),
	).toEqual([
		{
			goal_number: 1,
			challenge_goal: "前期の目標1",
			midterm_goal: "",
			carried_from_id: previousIds[0],
		},
	]);

	await actAs(db, 4);
	expect((await previousGoals(200))?.goals.map((goal) => goal.carried)).toEqual([true, false]);
	await expect(
		query("select public.carry_over_goal(200, $1)", [previousIds[0]]),
	).rejects.toMatchObject({
		code: "23505",
	});
	// 前の期のシートの目標でなければ引き継げない
	await expect(query("select public.carry_over_goal(200, 999999)")).rejects.toMatchObject({
		code: "P0002",
	});
});

it("stops carrying over once the draft holds the most goals allowed", async () => {
	await db.exec(
		"reset role; insert into public.milestones (sheet_id, goal_number, challenge_goal) values (200, 2, 'a'), (200, 3, 'b'), (200, 4, 'c')",
	);
	await actAs(db, 4);
	await expect(query("select public.carry_over_goal(200, $1)", [previousIds[1]])).rejects.toThrow(
		"チャレンジ目標は 4 件まで",
	);
	await db.exec(
		"reset role; delete from public.milestones where sheet_id = 200 and goal_number > 1",
	);
});

it("keeps the previous goals from people who cannot see the sheet yet", async () => {
	// 今期のシートは下書きなので、評価者にもまだ見せない
	await actAs(db, 2);
	expect(await previousGoals(200)).toBeNull();
	await expect(
		query("select public.carry_over_goal(200, $1)", [previousIds[1]]),
	).rejects.toMatchObject({
		code: "42501",
	});
	await actAs(db, 5);
	expect(await previousGoals(200)).toBeNull();
});

it("takes the previous period, not an older sheet, when the employee had no sheet just before", async () => {
	// 社員 6: 期間 2 の前の期間 3 にシートがあるが、期間 2(前の評価期間)にはシートが無い
	await db.exec(`
		reset role;
		set session_replication_role = replica;
		insert into public.evaluation_periods (id, period_name, term_name, start_date, end_date, is_active)
		values (3, '25期 上期', '25期', '2025-04-01', '2025-09-30', false);
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id)
		values (300, 3, 6, 'finalized', 2), (310, 1, 6, 'draft', 2);
		insert into public.milestones (sheet_id, goal_number, challenge_goal) values (300, 1, '古い目標');
		set session_replication_role = origin;
	`);
	expect(await one("select public.previous_evaluation_period(1) as v")).toBe(2);
	expect(await one("select public.previous_evaluation_period(2) as v")).toBe(3);
	expect(await one("select public.previous_evaluation_period(3) as v")).toBeNull();
	await actAs(db, 6);
	expect(await previousGoals(310)).toBeNull();
});

it("keeps which term and part each evaluation period is", async () => {
	// 準備で id を指定して入れた評価期間と、採番がぶつからないようにする
	await db.exec(
		"reset role; select setval(pg_get_serial_sequence('public.evaluation_periods', 'id'), 100)",
	);
	await actAs(db, 1);
	await query(
		`insert into public.evaluation_periods (period_name, term_name, division, part, start_date, end_date)
		 values ('27期 上期', '27期', 'half', 1, '2027-04-01', '2027-09-30'),
		        ('27期 下期', '27期', 'half', 2, '2027-10-01', '2028-03-31')`,
	);
	// 期の名前を省くと、評価期間の名前が期の名前になる(通年)
	await query(
		"insert into public.evaluation_periods (period_name, start_date, end_date) values ('28期', '2028-04-01', '2029-03-31')",
	);
	expect(
		await query(
			"select period_name, term_name, division, part from public.evaluation_periods where period_name like '2_期%' and period_name not like '25%' order by start_date",
		),
	).toEqual([
		{ period_name: "27期 上期", term_name: "27期", division: "half", part: 1 },
		{ period_name: "27期 下期", term_name: "27期", division: "half", part: 2 },
		{ period_name: "28期", term_name: "28期", division: "full", part: 1 },
	]);
	// 区切りにない番号は入らない。どの区切りかは後から変えられない
	await expect(
		query(
			"insert into public.evaluation_periods (period_name, term_name, division, part, start_date, end_date) values ('29期 第5', '29期', 'quarter', 5, '2029-04-01', '2029-06-30')",
		),
	).rejects.toMatchObject({ code: "23514" });
	await expect(
		query("update public.evaluation_periods set part = 2 where period_name = '28期'"),
	).rejects.toMatchObject({ code: "42501" });
	// 通年の評価期間の名前だけを変えると(これまでのアプリ)、期の名前も合わせる
	await query(
		"update public.evaluation_periods set period_name = '第28期' where period_name = '28期'",
	);
	expect(
		await one("select term_name as v from public.evaluation_periods where period_name = '第28期'"),
	).toBe("第28期");
	await db.exec(
		"reset role; delete from public.evaluation_periods where start_date >= '2027-04-01'",
	);
});

it("lets the evaluators read a sheet left as a draft once its period is closed", async () => {
	await actAs(db, 2);
	const closed = await one<{
		objectives: unknown[];
		period: { allowUnfinalizedClose: boolean; termName: string; division: string; part: number };
	}>("select public.get_sheet(100) as v");
	expect(closed.objectives).toHaveLength(2);
	expect(closed.period).toMatchObject({
		allowUnfinalizedClose: false,
		termName: "締め済み",
		division: "full",
		part: 1,
	});
	// 実施中の期間の下書きは、これまでどおり中身を見せない
	expect(
		(await one<{ objectives: unknown[] }>("select public.get_sheet(200) as v")).objectives,
	).toEqual([]);
});

const states = async () =>
	(
		await query<{ id: number; is_active: boolean; closed: boolean }>(
			"select id, is_active, closed_at is not null as closed from public.evaluation_periods where id in (1, 2, 4) order by id",
		)
	).map((row) => `${row.id}:${row.is_active ? "実施中" : row.closed ? "締め済み" : "未開始"}`);

it("never starts a closed period again", async () => {
	// 期間 4 はまだ始めていない。期間 2 は、移行のときに締め済みと分かる(実施中の期間より前に終わった)
	await db.exec(`reset role; insert into public.evaluation_periods (id, period_name, start_date, end_date)
		values (4, '来期', '2026-10-01', '2027-03-31')`);
	expect(await states()).toEqual(["1:実施中", "2:締め済み", "4:未開始"]);
	await actAs(db, 1);
	await expect(query("select public.activate_evaluation_period(2)")).rejects.toMatchObject({
		code: "23514",
		message: "締めた評価期間は、もう一度開始できません。",
	});
	// 締めた日時はアプリから書けない
	await expect(
		query("update public.evaluation_periods set closed_at = null where id = 2"),
	).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role");
	expect(await states()).toEqual(["1:実施中", "2:締め済み", "4:未開始"]);
});

it("closes a period with unfinalized sheets only when the Admin allowed it for that period", async () => {
	await actAs(db, 1);
	await expect(query("select public.activate_evaluation_period(4)")).rejects.toMatchObject({
		code: "23514",
		message: "未確定の評価シートが残っているため、評価期間を締められません。",
	});

	// Admin 以外は変えられない
	await actAs(db, 4);
	expect(
		await query(
			"update public.evaluation_periods set allow_unfinalized_close = true where id = 1 returning id",
		),
	).toEqual([]);

	await actAs(db, 1);
	await query("update public.evaluation_periods set allow_unfinalized_close = true where id = 1");
	expect(await one("select public.activate_evaluation_period(4) as v")).toBe(true);
	await db.exec("reset role");
	expect(await states()).toEqual(["1:締め済み", "2:締め済み", "4:実施中"]);
	// 締めたシートは下書きのまま残る
	expect(await one("select status as v from public.evaluation_sheets where id = 200")).toBe(
		"draft",
	);
	// 締めた評価期間には戻れない(締めの取り消しもしない)
	await actAs(db, 1);
	await expect(query("select public.activate_evaluation_period(1)")).rejects.toMatchObject({
		code: "23514",
	});
});

it("refuses periods the app could not read, so one bad row never hides the whole list", async () => {
	await db.exec("reset role");
	const insert = (columns: string, values: string) =>
		query(
			`insert into public.evaluation_periods (period_name, start_date, end_date, ${columns}) values ('壊れた期間', '2030-04-01', '2031-03-31', ${values})`,
		);
	// 実施中の評価期間を、締め済みにはできない
	await expect(
		query("update public.evaluation_periods set closed_at = now() where id = 4"),
	).rejects.toMatchObject({ code: "23514" });
	// 期の名前が長すぎる、区切りの番号が無い、終了日が開始日より前
	await expect(insert("term_name", `'${"期".repeat(41)}'`)).rejects.toMatchObject({
		code: "23514",
	});
	await expect(insert("division, part", "'half', 3")).rejects.toMatchObject({ code: "23514" });
	await expect(insert("division", "'monthly'")).rejects.toMatchObject({ code: "23514" });
	await expect(
		query(
			"insert into public.evaluation_periods (period_name, start_date, end_date) values ('逆さま', '2031-03-31', '2030-04-01')",
		),
	).rejects.toMatchObject({ code: "23514" });
	// 期の名前が空白だけなら、評価期間の名前を使う
	await insert("term_name", "'   '");
	expect(
		await one(
			"select term_name as v from public.evaluation_periods where period_name = '壊れた期間'",
		),
	).toBe("壊れた期間");
	await db.exec("delete from public.evaluation_periods where period_name = '壊れた期間'");
});

it("carries nothing into a sheet that is no longer a draft, into a closed period, or from nowhere", async () => {
	await actAs(db, 4);
	expect(await previousGoals(999999)).toBeNull();
	// 期間 1 は締めたので、下書きのままでも引き継げない
	await expect(
		query("select public.carry_over_goal(200, $1)", [previousIds[1]]),
	).rejects.toMatchObject({
		code: "23514",
	});
	await db.exec(
		"reset role; set session_replication_role = replica; update public.evaluation_sheets set status = 'submitted' where id = 200; set session_replication_role = origin",
	);
	await actAs(db, 4);
	await expect(
		query("select public.carry_over_goal(200, $1)", [previousIds[1]]),
	).rejects.toMatchObject({
		code: "42501",
	});
	await db.exec(
		"reset role; set session_replication_role = replica; update public.evaluation_sheets set status = 'draft' where id = 200; set session_replication_role = origin",
	);
});
