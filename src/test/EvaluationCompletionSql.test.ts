import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const read = (file: string) =>
	readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const migration = read("202610080005_evaluation_completion.sql");
const sheetGradeMigration = read("202610080007_evaluation_completion_sheet_grade.sql");
const status = async (id = 100) =>
	(
		await db.query<{ status: string }>(
			"select status from public.evaluation_sheets where id = $1",
			[id],
		)
	).rows[0].status;
const confirm = (next: string, id = 100) =>
	db.query("update public.evaluation_sheets set status = $1 where id = $2", [next, id]);

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated;
		create table public.employee_grades (id smallint primary key, item_set_id smallint);
		create table public.employees (id integer primary key, grade_id smallint, no_secondary_evaluator boolean, secondary_evaluator_id integer);
		create table public.evaluation_sheets (id bigint primary key, employee_id integer, status text, first_rank text, grade_id smallint);
		create table public.milestones (id bigint primary key, sheet_id bigint, goal_number integer, first_score smallint, second_score smallint);
		create table public.common_evaluation_items (id bigint primary key, title text, item_set_id smallint);
		create table public.common_evaluation_results (id bigint primary key, sheet_id bigint, item_id bigint, first_score smallint, second_score smallint);
		insert into public.employee_grades values (1, 1), (2, 2);
		insert into public.employees values (1, 1, false, 3), (4, 1, true, null);
		insert into public.evaluation_sheets values (100, 1, 'submitted', null, 1), (200, 4, 'submitted', null, 1);
		insert into public.milestones values (11, 100, 1, 4, 0), (12, 100, 2, 4, 0), (21, 200, 1, 4, 0);
		insert into public.common_evaluation_items values (31, '全員共通', null), (32, '1級共通', 1), (33, '2級共通', 2);
		grant select, update on public.evaluation_sheets to authenticated;
	`);
	await db.exec(migration);
	await db.exec(migration);
	await db.exec(sheetGradeMigration);
	await db.exec(sheetGradeMigration);
}, 30_000);
beforeEach(async () => {
	await db.exec(`reset role;
		update public.evaluation_sheets set status = 'submitted', grade_id = 1;
		update public.employees set grade_id = 1;
		update public.milestones set first_score = 4, second_score = 0;
		truncate public.common_evaluation_results;
		insert into public.common_evaluation_results values (41, 100, 31, 4, 0), (42, 100, 32, 4, 0), (43, 200, 31, 4, 0), (44, 200, 32, 4, 0);
	`);
});
afterAll(async () => {
	await db?.close();
});

it.each([0, null])("rejects an unset primary score (%s) in either goal", async (score) => {
	await db.query("update public.milestones set first_score = $1 where id = 12", [score]);
	await expect(confirm("first_evaluated")).rejects.toThrow("チャレンジ目標 2");
	expect(await status()).toBe("submitted");
});

it("requires every grade-specific common item even when it has no saved result", async () => {
	await db.exec("delete from public.common_evaluation_results where id = 42");
	await expect(confirm("first_evaluated")).rejects.toThrow("共通評価「1級共通」");
	expect(await status()).toBe("submitted");
});

it("validates only the confirming stage and does not require the other evaluator's scores", async () => {
	await confirm("first_evaluated");
	expect(await status()).toBe("first_evaluated");
	await expect(confirm("finalized")).rejects.toThrow("二次評価に未設定");
	await db.exec(
		"update public.milestones set second_score = 1, first_score = 0 where sheet_id = 100; update public.common_evaluation_results set second_score = 1, first_score = 0 where sheet_id = 100",
	);
	await confirm("finalized");
	expect(await status()).toBe("finalized");
});

it("validates primary scores when the primary evaluator also finalizes", async () => {
	await db.exec("update public.common_evaluation_results set first_score = 0 where id = 44");
	await expect(confirm("finalized", 200)).rejects.toThrow("一次評価に未設定");
	await db.exec("update public.common_evaluation_results set first_score = 1 where id = 44");
	await confirm("finalized", 200);
	expect(await status(200)).toBe("finalized");
});

it("checks the items of the grade the sheet was created with, not the employee's current grade", async () => {
	// 昇格しても、昇格前に作ったシートは作成時の等級(1級)の項目で確定できる
	await db.exec("update public.employees set grade_id = 2 where id = 1");
	await confirm("first_evaluated");
	await confirm("submitted");
	await db.exec("update public.evaluation_sheets set grade_id = 2 where id = 100");
	await expect(confirm("first_evaluated")).rejects.toThrow("共通評価「2級共通」");
	await db.exec("insert into public.common_evaluation_results values (45, 100, 33, 4, 0)");
	await confirm("first_evaluated");
});

it.each([-1, 5])("rejects out-of-range persisted score %s", async (score) => {
	await db.query("update public.common_evaluation_results set first_score = $1 where id = 41", [
		score,
	]);
	await expect(confirm("first_evaluated")).rejects.toMatchObject({ code: "23514" });
});

it("guards direct authenticated updates and keeps a rejected rank update atomic", async () => {
	await db.exec(
		"update public.milestones set first_score = 0 where id = 12; set role authenticated",
	);
	await expect(
		db.exec(
			"update public.evaluation_sheets set status = 'first_evaluated', first_rank = 'S' where id = 100",
		),
	).rejects.toMatchObject({ code: "23514" });
	expect(
		(await db.query("select status, first_rank from public.evaluation_sheets where id = 100"))
			.rows[0],
	).toEqual({ status: "submitted", first_rank: null });
	await expect(db.query("select public.check_evaluation_completion()")).rejects.toMatchObject({
		code: "42501",
	});
});

it("permits submission, reversion, and updates that do not newly confirm a stage", async () => {
	await db.exec("update public.milestones set first_score = 0");
	await confirm("draft");
	await confirm("submitted");
	await confirm("submitted");
	expect(await status()).toBe("submitted");
});
