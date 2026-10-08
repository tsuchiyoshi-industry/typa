import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
const migration = readFileSync(
	new URL(
		"../../supabase/migrations/202610060003_common_evaluation_item_sets.sql",
		import.meta.url,
	),
	"utf8",
);
/** 等級ごとに、その等級の社員が評価される項目(アプリの取得条件と同じ)を並べる。 */
const itemsByGrade = async () => {
	const { rows } = await db.query<{ grade_name: string; titles: string[] }>(`
		select grade.grade_name,
		       array(select item.title from public.common_evaluation_items as item
		             where item.item_set_id is null or item.item_set_id = grade.item_set_id
		             order by item.id) as titles
		from public.employee_grades as grade order by grade.id
	`);
	return Object.fromEntries(rows.map((row) => [row.grade_name, row.titles]));
};

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create table public.employee_grades (id smallint primary key, grade_name text not null);
		create table public.common_evaluation_items (
			id bigint primary key, title text not null, grade_id smallint references public.employee_grades (id)
		);
		insert into public.employee_grades values (1, '技術1級'), (2, '一般1級'), (3, '技術2級');
		insert into public.common_evaluation_items values
			(10, '全等級共通', null), (11, '1級の項目A', 1), (12, '1級の項目B', 1), (13, '2級の項目', 3);
	`);
	await db.exec(migration);
	// Re-applying the migration changes nothing.
	await db.exec(migration);
}, 30_000);
afterAll(async () => {
	await db?.close();
});

it("keeps every grade on the items it had, and drops the per-item grade", async () => {
	expect(await itemsByGrade()).toEqual({
		技術1級: ["全等級共通", "1級の項目A", "1級の項目B"],
		一般1級: ["全等級共通"],
		技術2級: ["全等級共通", "2級の項目"],
	});
	const sets = await db.query<{ name: string }>(
		"select name from public.common_evaluation_item_sets order by id",
	);
	expect(sets.rows.map((row) => row.name)).toEqual(["技術1級", "技術2級"]);
	const columns = await db.query(
		"select 1 from information_schema.columns where table_name = 'common_evaluation_items' and column_name = 'grade_id'",
	);
	expect(columns.rows).toHaveLength(0);
});
it("lets a second grade share the same item set", async () => {
	await db.exec(`
		update public.employee_grades
		set item_set_id = (select item_set_id from public.employee_grades where grade_name = '技術1級')
		where grade_name = '一般1級'
	`);
	const items = await itemsByGrade();
	expect(items.一般1級).toEqual(items.技術1級);
	expect(items.一般1級).toEqual(["全等級共通", "1級の項目A", "1級の項目B"]);
});
