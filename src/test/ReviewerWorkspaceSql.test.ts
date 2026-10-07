import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { ReviewerRowDto } from "../application/dtos/ReviewerWorkspaceDto";

let db: PGlite;
const migration = readFileSync(
	new URL("../../supabase/migrations/202610070001_reviewer_workspace.sql", import.meta.url),
	"utf8",
);
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
const login = async (id: number) => {
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(id)]);
};
const workspace = async () =>
	(await db.query<{ data: ReviewerRowDto[] }>("select public.get_reviewer_workspace(10) as data"))
		.rows[0].data;
const mark = async (row: ReviewerRowDto, reviewed = true) =>
	db.query("select public.set_sheet_reviewed($1, $2, $3)", [row.sheetId, row.revision, reviewed]);

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated; create schema auth;
		create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table public.employee_grades (id smallint primary key, grade_name text, item_set_id smallint);
		create table public.employees (id integer primary key, user_id uuid, name text, employee_no text, grade_id smallint, career_course text, primary_evaluator_id integer, secondary_evaluator_id integer, no_secondary_evaluator boolean default false);
		create table public.evaluation_sheets (id bigint primary key, employee_id integer, period_id bigint, status text, updated_at timestamptz default now(), first_overall_comment text, second_overall_comment text, final_rank_letter text, final_rank_level text, total_evaluation_score integer);
		create table public.milestones (id bigint primary key, sheet_id bigint, goal_number integer, challenge_goal text, midterm_goal text, achievement text, first_score integer, second_score integer);
		create table public.common_evaluation_items (id bigint primary key, title text, description text, weight integer, item_set_id smallint);
		create table public.common_evaluation_results (id bigint primary key, sheet_id bigint, item_id bigint, first_score integer, second_score integer, first_comment text);
		insert into public.employee_grades values (1, '技術1級', 1), (2, '技術2級', 2);
		insert into public.employees (id, user_id, name, employee_no, grade_id, career_course, primary_evaluator_id, secondary_evaluator_id)
		select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, '社員' || id, 'E00' || id, 1, '技術', 2, 3 from generate_series(1, 8) id;
		insert into public.evaluation_sheets values (100, 1, 10, 'submitted', now(), '一次の根拠', '二次の根拠', 'A', 'plus', 80), (104, 4, 10, 'draft', now(), '', '', null, null, 0), (106, 6, 10, 'finalized', now(), '', '', 'B', 'none', 60);
		insert into public.milestones values (11, 100, 1, '目標', '中間', '達成', 0, 4);
		insert into public.common_evaluation_items values (21, '全員共通', '説明', 5, null), (22, '1級共通', '説明', 5, 1), (23, '2級共通', '説明', 5, 2);
		insert into public.common_evaluation_results values (31, 100, 21, 0, 4, '一次コメント');
	`);
	await db.exec(migration);
	await db.exec(migration);
}, 30_000);
beforeEach(async () => {
	await db.exec(`reset role; delete from public.sheet_review_checkpoints;
		update public.employees set primary_evaluator_id = 2, secondary_evaluator_id = 3, no_secondary_evaluator = false, grade_id = 1;
		update public.evaluation_sheets set status = 'submitted', first_overall_comment = '一次の根拠', second_overall_comment = '二次の根拠', total_evaluation_score = 80 where id = 100;
		update public.milestones set first_score = 0, second_score = 4, achievement = '達成' where id = 11;
		update public.common_evaluation_items set weight = 5;
		update public.common_evaluation_results set first_score = 0, second_score = 4;
		set role authenticated;`);
	await login(3);
});
afterAll(async () => {
	await db?.close();
});

it("returns the entire caseload including missing sheets, draft and finalized; excludes self", async () => {
	const rows = await workspace();
	expect(rows).toHaveLength(7);
	expect(rows.find((r) => r.employeeId === 3)).toBeUndefined();
	expect(rows.find((r) => r.employeeId === 5)).toMatchObject({
		sheetId: null,
		status: "missing",
		revision: null,
		objectives: [],
		commonItems: [],
	});
	expect(rows.find((r) => r.employeeId === 4)?.status).toBe("draft");
	expect(rows.find((r) => r.employeeId === 6)?.status).toBe("finalized");
	expect(rows[0]).toMatchObject({
		role: "secondary",
		canViewSecond: true,
		canViewFinal: true,
		secondOverallComment: "二次の根拠",
		finalRank: "A+",
	});
	expect(rows[0].commonItems.map((item) => item.id)).toEqual([21, 22]);
});
it("masks every secondary field and final result for a primary evaluator", async () => {
	await login(2);
	const row = (await workspace())[0];
	expect(row).toMatchObject({
		role: "primary",
		canViewSecond: false,
		canViewFinal: false,
		secondOverallComment: null,
		finalRank: null,
		finalScore: null,
	});
	expect(row.objectives.every((item) => item.secondScore === null)).toBe(true);
	expect(row.commonItems.every((item) => item.secondScore === null)).toBe(true);
	const revision = row.revision;
	await db.exec(
		"reset role; update public.milestones set second_score = 2; update public.evaluation_sheets set second_overall_comment = 'secret' where id = 100; set role authenticated;",
	);
	expect((await workspace())[0].revision).toBe(revision);
});
it("records a zero-score review explicitly and shares only primary confirmation with secondary", async () => {
	await login(2);
	const row = (await workspace())[0];
	expect(row.reviewed).toBe(false);
	await mark(row);
	expect((await workspace())[0]).toMatchObject({
		reviewed: true,
		needsRecheck: false,
		primaryReviewed: true,
	});
	await login(3);
	expect((await workspace())[0]).toMatchObject({ reviewed: false, primaryReviewed: true });
	await mark((await workspace())[0]);
	expect((await workspace())[0].reviewed).toBe(true);
});
it("invalidates review after relevant content changes and rejects stale marking", async () => {
	const row = (await workspace())[0];
	await mark(row);
	await db.exec(
		"reset role; update public.common_evaluation_results set first_score = 3 where id = 31; set role authenticated;",
	);
	expect((await workspace())[0]).toMatchObject({ reviewed: false, needsRecheck: true });
	await expect(mark(row)).rejects.toMatchObject({ code: "40001" });
	await mark((await workspace())[0]);
	expect((await workspace())[0]).toMatchObject({ reviewed: true, needsRecheck: false });
	await mark((await workspace())[0], false);
	expect((await workspace())[0]).toMatchObject({
		reviewed: false,
		needsRecheck: false,
		reviewedAt: null,
	});
});
it("preserves primary confirmation through secondary edits and finalization", async () => {
	await login(2);
	await mark((await workspace())[0]);
	await db.exec(
		"reset role; update public.milestones set second_score = 2 where id = 11; update public.evaluation_sheets set status = 'finalized', total_evaluation_score = 68 where id = 100; set role authenticated;",
	);
	expect((await workspace())[0]).toMatchObject({ reviewed: true, primaryReviewed: true });
});
it("invalidates review for changed goal evidence, weights, and grade", async () => {
	for (const sql of [
		"update public.milestones set achievement = '更新' where id = 11",
		"update public.common_evaluation_items set weight = 4 where id = 21",
		"update public.employees set grade_id = 2 where id = 1",
	]) {
		await mark((await workspace())[0]);
		await db.exec(`reset role; ${sql}; set role authenticated;`);
		expect((await workspace())[0]).toMatchObject({ reviewed: false, needsRecheck: true });
	}
});
it("allows a primary final evaluator to see final results without leaking a secondary score", async () => {
	await db.exec(
		"reset role; update public.employees set secondary_evaluator_id = null, no_secondary_evaluator = true where id = 1; set role authenticated;",
	);
	await login(2);
	expect((await workspace())[0]).toMatchObject({
		canViewFinal: true,
		canViewSecond: false,
		finalRank: "A+",
	});
});
it("handles the same evaluator assigned to both stages", async () => {
	await db.exec(
		"reset role; update public.employees set primary_evaluator_id = 3 where id = 1; set role authenticated;",
	);
	await mark((await workspace())[0]);
	expect((await workspace())[0]).toMatchObject({ reviewed: true, primaryReviewed: true });
});
it("denies unrelated users, subjects, removed assignments, draft/finalized sheets and direct table access", async () => {
	const row = (await workspace())[0];
	await login(1);
	await expect(mark(row)).rejects.toMatchObject({ code: "42501" });
	await login(7);
	expect(await workspace()).toEqual([]);
	await expect(mark(row)).rejects.toMatchObject({ code: "42501" });
	await login(3);
	await expect(db.query("select public.set_sheet_reviewed(104, '', true)")).rejects.toThrow();
	await expect(db.query("select public.set_sheet_reviewed(106, '', true)")).rejects.toThrow();
	await expect(db.query("select * from public.sheet_review_checkpoints")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(
		db.query("select public.reviewer_sheet_snapshot(100, 'secondary')"),
	).rejects.toMatchObject({ code: "42501" });
	await db.exec(
		"reset role; update public.employees set secondary_evaluator_id = 7 where id = 1; set role authenticated;",
	);
	await expect(mark(row)).rejects.toMatchObject({ code: "42501" });
});
it("denies anonymous RPCs and missing JWT claims", async () => {
	await db.exec("reset role; set role anon");
	await expect(workspace()).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role authenticated");
	await db.query("select set_config('request.jwt.claim.sub', '', false)");
	await expect(workspace()).rejects.toMatchObject({ code: "42501" });
});
