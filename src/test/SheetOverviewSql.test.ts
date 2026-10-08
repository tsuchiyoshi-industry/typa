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
			first_overall_comment text, total_evaluation_score integer, final_rank_letter text,
			created_at timestamptz default '2026-04-01T00:00:00Z', updated_at timestamptz default '2026-10-05T00:00:00Z');
		alter table public.evaluation_sheets enable row level security;
		create table public.milestones (id bigint primary key, sheet_id bigint);
		create table public.common_evaluation_results (id bigint primary key, sheet_id bigint);
		grant select on public.evaluation_sheets, public.employees, public.roles to authenticated;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, grade_id, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator, first_overall_comment, total_evaluation_score, final_rank_letter) values
			(100, 25, 3, 'finalized', 1, 2, 1, false, '一次の根拠', 88, 'A'),
			(200, 26, 4, 'draft', 2, 2, null, true, '', 0, null),
			(201, 26, 3, 'submitted', 2, 2, null, false, '', 0, null),
			(202, 26, 2, 'first_evaluated', null, null, 1, false, '', 0, null);
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
	});
	// 二次評価者「なし」と、未設定(null のまま「なし」ではない)を区別できる
	expect(rows[2]).toMatchObject({ secondaryEvaluator: null, noSecondaryEvaluator: true });
	expect(rows[1]).toMatchObject({ secondaryEvaluator: null, noSecondaryEvaluator: false });
	expect(rows[0]).toMatchObject({ gradeName: "", primaryEvaluator: null });
});

it("carries no evaluation content, even for a finalized sheet", async () => {
	for (const row of await overview()) {
		expect(Object.keys(row).sort()).toEqual([
			"createdAt",
			"employeeId",
			"employeeName",
			"employeeNo",
			"gradeName",
			"id",
			"noSecondaryEvaluator",
			"periodEnd",
			"periodId",
			"periodName",
			"periodStart",
			"primaryEvaluator",
			"secondaryEvaluator",
			"status",
			"updatedAt",
		]);
	}
});

it("refuses everyone but an Admin, including an evaluator of the sheets and anonymous callers", async () => {
	for (const other of [2, 3, 4]) {
		await login(other);
		await expect(overview()).rejects.toMatchObject(denied);
	}
	await db.exec("reset role; set role anon");
	await expect(overview()).rejects.toMatchObject(denied);
	// DB 関数を通さなければ、Admin でも表からは読めないまま(内容を見せる経路を増やしていない)
	await db.exec("reset role; set role authenticated");
	await login(1);
	expect((await db.query("select id from public.evaluation_sheets")).rows).toEqual([]);
});
