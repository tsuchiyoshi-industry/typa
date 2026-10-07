import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
const migration = readFileSync(
	new URL("../../supabase/migrations/202610080002_sheet_grade.sql", import.meta.url),
	"utf8",
);
const grades = async () =>
	(
		await db.query<{ id: number; grade_id: number | null }>(
			"select id, grade_id from public.evaluation_sheets order by id",
		)
	).rows;

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated;
		create table public.employee_grades (id smallint primary key, grade_name text);
		create table public.employees (id integer primary key, grade_id smallint);
		create table public.evaluation_sheets (id bigint primary key, employee_id integer, period_id bigint, unique (period_id, employee_id));
		insert into public.employee_grades values (1, '1級'), (2, '2級');
		insert into public.employees values (1, 1), (2, null);
		insert into public.evaluation_sheets values (100, 1, 10);
	`);
	await db.exec(migration);
	await db.exec(migration);
}, 30_000);
afterAll(async () => {
	await db?.close();
});

it("keeps the grade held when the sheet was created, whatever the client sends or the employee becomes", async () => {
	// 既存のシートは、分かる範囲で今の等級を入れる
	expect(await grades()).toEqual([{ id: 100, grade_id: 1 }]);
	await db.exec("update public.employees set grade_id = 2 where id = 1");
	// 昇格後に作ったシートは新しい等級。クライアントが渡した値は使わない
	await db.exec(
		"insert into public.evaluation_sheets (id, employee_id, period_id, grade_id) values (101, 1, 11, 1), (102, 2, 11, 2)",
	);
	// アプリの「作成または取得」(upsert)で、既存シートの等級は書き換わらない
	await db.exec(
		"insert into public.evaluation_sheets (id, employee_id, period_id) values (103, 1, 10) on conflict (period_id, employee_id) do update set period_id = excluded.period_id",
	);
	expect(await grades()).toEqual([
		{ id: 100, grade_id: 1 },
		{ id: 101, grade_id: 2 },
		{ id: 102, grade_id: null },
	]);
});
