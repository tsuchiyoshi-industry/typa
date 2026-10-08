import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const migration = (file: string) =>
	readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const overviewMigration = migration("202610080016_sheet_overview.sql");
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
/** 1: Admin, 2: Reviewer(社員3・4 の一次評価者), 3・4: Employee */
const login = async (id: number) => {
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(id)]);
};
const overview = async () =>
	(
		await db.query<{ data: Record<string, unknown>[] }>(
			"select public.get_sheet_overview() as data",
		)
	).rows[0].data;
const denied = { code: "42501" };

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated; create schema auth;
		create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table public.roles (id integer primary key, role_name text);
		insert into public.roles values (1, 'Admin'), (2, 'Reviewer'), (3, 'Employee');
		create table public.employee_grades (id smallint primary key, grade_name text);
		insert into public.employee_grades values (1, '総合Ⅰ級'), (2, '総合Ⅱ級');
		create table public.employees (id integer primary key, user_id uuid, name text, employee_no text, role_id integer, grade_id smallint);
		insert into public.employees select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, '社員' || id, 'E00' || id, least(id, 3), 2 from generate_series(1, 4) id;
		create table public.evaluation_periods (id bigint primary key, period_name text, start_date date, end_date date, is_active boolean not null default false);
		insert into public.evaluation_periods values (25, '25期', '2025-03-24', '2026-03-22', false), (26, '26期', '2026-03-23', '2027-02-19', true);
		-- 本番と同じ: クライアントは、自分に関係のないシートを表から直接は読めない
		create table public.evaluation_sheets (id bigint primary key, period_id bigint, employee_id integer, status text, grade_id smallint,
			primary_evaluator_id integer, secondary_evaluator_id integer, no_secondary_evaluator boolean not null default false,
			first_overall_comment text, total_evaluation_score integer, final_rank_letter text, final_rank_level text,
			created_at timestamptz default '2026-04-01T00:00:00Z', updated_at timestamptz default '2026-10-05T00:00:00Z');
		alter table public.evaluation_sheets enable row level security;
		create table public.milestones (id bigint primary key, sheet_id bigint, first_score integer default 0);
		create table public.common_evaluation_results (id bigint primary key, sheet_id bigint, first_score integer default 0);
		alter table public.milestones enable row level security;
		alter table public.common_evaluation_results enable row level security;
		grant select on public.employees, public.roles to authenticated;
		grant select, insert, update, delete on public.evaluation_sheets, public.milestones, public.common_evaluation_results to authenticated;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, grade_id, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator, first_overall_comment, total_evaluation_score, final_rank_letter, final_rank_level) values
			(100, 25, 3, 'finalized', 1, 2, 1, false, '一次の根拠', 88, 'B', 'plus'),
			(200, 26, 4, 'draft', 2, 2, null, true, '', 0, null, null),
			(201, 26, 3, 'submitted', 2, 2, null, false, '', 0, null, null),
			-- 確定前の集計値は見込みで、結果としては出さない
			(202, 26, 2, 'first_evaluated', null, null, 1, false, '', 73, 'B', 'none');
		insert into public.milestones (id, sheet_id) values (11, 100), (21, 201);
		insert into public.common_evaluation_results (id, sheet_id) values (31, 100), (41, 201);
	`);
	await db.exec(migration("202610080008_evaluation_period_management.sql"));
	await db.exec(overviewMigration);
	await db.exec(overviewMigration);
}, 30_000);
beforeEach(async () => {
	await db.exec("reset role; set role authenticated;");
	await login(1);
});
afterAll(async () => {
	await db?.close();
});

it("gives an Admin every sheet of every period, newest period first, by employee number", async () => {
	const rows = await overview();
	expect(rows.map((row) => [row.id, row.periodName, row.employeeNo, row.status])).toEqual([
		[202, "26期", "E002", "first_evaluated"],
		[201, "26期", "E003", "submitted"],
		// 下書きも、進み具合として並ぶ
		[200, "26期", "E004", "draft"],
		[100, "25期", "E003", "finalized"],
	]);
	// 等級はシートを作成したときのもの(社員の今の等級は総合Ⅱ級)。評価者はシートが持つもの
	expect(rows[3]).toMatchObject({
		periodId: 25,
		employeeId: 3,
		employeeName: "社員3",
		periodStart: "2025-03-24",
		periodEnd: "2026-03-22",
		gradeName: "総合Ⅰ級",
		primaryEvaluator: "社員2",
		secondaryEvaluator: "社員1",
		noSecondaryEvaluator: false,
		// 確定したシートには、その結果が付く
		finalScore: 88,
		finalRank: "B+",
	});
	// 二次評価者「なし」と、未設定(null のまま「なし」ではない)を区別できる
	expect(rows[2]).toMatchObject({ secondaryEvaluator: null, noSecondaryEvaluator: true });
	expect(rows[1]).toMatchObject({ secondaryEvaluator: null, noSecondaryEvaluator: false });
	expect(rows[0]).toMatchObject({
		gradeName: "",
		primaryEvaluator: null,
		finalScore: null,
		finalRank: null,
	});
});

it("refuses the overview to everyone but an Admin, including an evaluator of the sheets and anonymous callers", async () => {
	for (const other of [2, 3, 4]) {
		await login(other);
		await expect(overview()).rejects.toMatchObject(denied);
	}
	await db.exec("reset role; set role anon");
	await expect(overview()).rejects.toMatchObject(denied);
});

it("lets an Admin read every sheet with its goals and common results, and change none of them", async () => {
	const ids = async (table: string) =>
		(await db.query<{ id: number }>(`select id from public.${table} order by id`)).rows.map((row) =>
			Number(row.id),
		);
	expect(await ids("evaluation_sheets")).toEqual([100, 200, 201, 202]);
	expect(await ids("milestones")).toEqual([11, 21]);
	expect(await ids("common_evaluation_results")).toEqual([31, 41]);

	// 読めるだけ。実施中の期間のシートでも、Admin であることでは書き換えられない
	for (const change of [
		"update public.evaluation_sheets set status = 'finalized' where id = 201 returning id",
		"delete from public.evaluation_sheets where id = 201 returning id",
		"update public.milestones set first_score = 4 where sheet_id = 201 returning id",
		"delete from public.milestones where sheet_id = 201 returning id",
		"update public.common_evaluation_results set first_score = 4 where sheet_id = 201 returning id",
		"delete from public.common_evaluation_results where sheet_id = 201 returning id",
	]) {
		expect((await db.query(change)).rows, change).toEqual([]);
	}
	for (const change of [
		"insert into public.evaluation_sheets (id, period_id, employee_id, status) values (203, 26, 1, 'draft')",
		"insert into public.milestones (id, sheet_id) values (22, 201)",
		"insert into public.common_evaluation_results (id, sheet_id) values (42, 201)",
	]) {
		await expect(db.query(change), change).rejects.toMatchObject(denied);
	}
	expect(await ids("evaluation_sheets")).toEqual([100, 200, 201, 202]);
	expect(
		(
			await db.query(
				"select status, first_score from public.evaluation_sheets s join public.milestones m on m.sheet_id = s.id where s.id = 201",
			)
		).rows,
	).toEqual([{ status: "submitted", first_score: 0 }]);

	// 追加したのは Admin の読み取りだけ。ほかの人が読める範囲は変わらない(この表には他のポリシーがない)
	for (const other of [2, 3]) {
		await login(other);
		expect(await ids("evaluation_sheets")).toEqual([]);
		expect(await ids("milestones")).toEqual([]);
		expect(await ids("common_evaluation_results")).toEqual([]);
	}
});
