import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { ReviewerRowDto } from "../application/dtos/ReviewerWorkspaceDto";

let db: PGlite;
const migration = (file: string) =>
	readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const stages = migration("202610080001_evaluation_stages.sql");
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
const login = async (id: number) => {
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(id)]);
};
const asAdmin = (sql: string) => db.exec(`reset role; ${sql}; set role authenticated;`);
const workspace = async () =>
	(await db.query<{ data: ReviewerRowDto[] }>("select public.get_reviewer_workspace(10) as data"))
		.rows[0].data;
const recipient = async (sheetId = 100) =>
	(
		await db.query<{ email: string | null }>(
			"select public.get_first_evaluated_sheet_notification_recipient($1) as email",
			[sheetId],
		)
	).rows[0].email;

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated; create schema auth;
		create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table auth.users (id uuid primary key, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
		create table public.employee_grades (id smallint primary key, grade_name text, item_set_id smallint);
		create table public.employees (id integer primary key, user_id uuid, name text, employee_no text, grade_id smallint, career_course text, primary_evaluator_id integer, secondary_evaluator_id integer, no_secondary_evaluator boolean default false);
		create table public.evaluation_sheets (id bigint primary key, employee_id integer, period_id bigint, status text, updated_at timestamptz default now(), first_overall_comment text, second_overall_comment text, final_rank_letter text, final_rank_level text, total_evaluation_score integer);
		create table public.milestones (id bigint primary key, sheet_id bigint, goal_number integer, challenge_goal text, midterm_goal text, achievement text, first_score integer, second_score integer);
		create table public.common_evaluation_items (id bigint primary key, title text, description text, weight integer, item_set_id smallint);
		create table public.common_evaluation_results (id bigint primary key, sheet_id bigint, item_id bigint, first_score integer, second_score integer, first_comment text);
		insert into public.employee_grades values (1, '技術1級', 1), (2, '技術2級', 2);
		insert into auth.users select ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, now(),
			jsonb_build_object('contact_email', 'employee' || id || '@example.jp') from generate_series(1, 8) id;
		insert into public.employees (id, user_id, name, employee_no, grade_id, career_course, primary_evaluator_id, secondary_evaluator_id)
		select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, '社員' || id, 'E00' || id, 1, '技術', 2, 3 from generate_series(1, 8) id;
		insert into public.evaluation_sheets values (100, 1, 10, 'submitted', now(), '一次の根拠', '二次の根拠', 'A', 'plus', 80), (104, 4, 10, 'draft', now(), '下書きの総評', '', null, null, 0), (106, 6, 10, 'finalized', now(), '', '', 'B', 'none', 60);
		insert into public.milestones values (11, 100, 1, '目標', '中間', '達成', 0, 4), (14, 104, 1, '下書きの目標', '', '', 0, 0);
		insert into public.common_evaluation_items values (21, '全員共通', '説明', 5, null), (22, '1級共通', '説明', 5, 1), (23, '2級共通', '説明', 5, 2);
		insert into public.common_evaluation_results values (31, 100, 21, 0, 4, '一次コメント');
	`);
	// 確認記録(チェックポイント)を作った前のマイグレーションの上に適用し、再適用もできること
	await db.exec(migration("202610070001_reviewer_workspace.sql"));
	await db.exec(stages);
	await db.exec(stages);
}, 30_000);
beforeEach(async () => {
	await db.exec(`reset role;
		update auth.users set email_confirmed_at = now();
		update public.employees set primary_evaluator_id = 2, secondary_evaluator_id = 3, no_secondary_evaluator = false, grade_id = 1;
		update public.evaluation_sheets set status = 'submitted', first_rank = null, final_rank_letter = 'A', final_rank_level = 'plus', total_evaluation_score = 80 where id = 100;
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
		objectives: [],
		commonItems: [],
	});
	expect(rows.find((r) => r.employeeId === 6)?.status).toBe("finalized");
	expect(rows[0]).toMatchObject({
		isPrimary: false,
		canViewSecond: true,
		canViewFinal: true,
		primaryIsFinal: false,
		status: "submitted",
		secondOverallComment: "二次の根拠",
	});
	expect(rows[0].commonItems.map((item) => item.id)).toEqual([21, 22]);
});
it("exposes nothing of a draft to its evaluators", async () => {
	for (const evaluator of [2, 3]) {
		await login(evaluator);
		expect((await workspace()).find((r) => r.employeeId === 4)).toMatchObject({
			sheetId: 104,
			status: "draft",
			firstOverallComment: "",
			secondOverallComment: null,
			firstRank: null,
			finalRank: null,
			objectives: [],
			commonItems: [],
		});
	}
});
it("masks every secondary field and the final result for a primary evaluator", async () => {
	await asAdmin(
		"update public.evaluation_sheets set status = 'finalized', first_rank = 'D' where id = 100",
	);
	await login(2);
	const row = (await workspace())[0];
	expect(row).toMatchObject({
		isPrimary: true,
		canViewSecond: false,
		canViewFinal: false,
		firstRank: "D",
		secondOverallComment: null,
		finalRank: null,
		finalScore: null,
	});
	expect(row.objectives.every((item) => item.secondScore === null)).toBe(true);
	expect(row.commonItems.every((item) => item.secondScore === null)).toBe(true);
});
it("shows each rank only once its stage is confirmed", async () => {
	// 提出済み: 手入力で残っていた最終ランク(A+)は確定前には出さない
	expect((await workspace())[0]).toMatchObject({ firstRank: null, finalRank: null });
	await asAdmin(
		"update public.evaluation_sheets set status = 'first_evaluated', first_rank = 'B-' where id = 100",
	);
	expect((await workspace())[0]).toMatchObject({
		status: "first_evaluated",
		firstRank: "B-",
		finalRank: null,
		finalScore: null,
	});
	await asAdmin(
		"update public.evaluation_sheets set status = 'finalized', final_rank_letter = 'B', final_rank_level = 'plus' where id = 100",
	);
	expect((await workspace())[0]).toMatchObject({
		status: "finalized",
		firstRank: "B-",
		finalRank: "B+",
		finalScore: 80,
	});
});
it("allows a primary final evaluator to see final results without leaking a secondary score", async () => {
	await asAdmin(
		"update public.employees set secondary_evaluator_id = null, no_secondary_evaluator = true where id = 1; update public.evaluation_sheets set status = 'finalized', first_rank = 'B+', final_rank_letter = 'B', final_rank_level = 'plus' where id = 100",
	);
	await login(2);
	const row = (await workspace())[0];
	expect(row).toMatchObject({
		isPrimary: true,
		canViewFinal: true,
		canViewSecond: false,
		primaryIsFinal: true,
		firstRank: "B+",
		finalRank: "B+",
	});
	expect(row.objectives.every((item) => item.secondScore === null)).toBe(true);
});
it("handles the same evaluator assigned to both stages", async () => {
	await asAdmin("update public.employees set primary_evaluator_id = 3 where id = 1");
	expect((await workspace())[0]).toMatchObject({
		isPrimary: true,
		canViewSecond: true,
		canViewFinal: true,
	});
});
it("replaces review checkpoints and accepts only the known stages and ranks", async () => {
	await expect(db.query("select public.set_sheet_reviewed(100, '', true)")).rejects.toThrow();
	await expect(db.query("select * from public.sheet_review_checkpoints")).rejects.toThrow();
	await db.exec("reset role");
	await expect(
		db.exec("update public.evaluation_sheets set status = 'reviewed' where id = 100"),
	).rejects.toThrow("evaluation_sheets_status_check");
	await expect(
		db.exec("update public.evaluation_sheets set first_rank = 'A+' where id = 100"),
	).rejects.toThrow("evaluation_sheets_first_rank_check");
});
it("gives the secondary evaluator's contact email only to the primary evaluator of a first-evaluated sheet", async () => {
	await login(2);
	// まだ一次評価を確定していない
	await expect(recipient()).rejects.toMatchObject({ code: "42501" });
	await asAdmin("update public.evaluation_sheets set status = 'first_evaluated' where id = 100");
	expect(await recipient()).toBe("employee3@example.jp");
	for (const other of [1, 3, 7]) {
		await login(other);
		await expect(recipient()).rejects.toMatchObject({ code: "42501" });
	}
	await login(2);
	await asAdmin(`update auth.users set email_confirmed_at = null where id = '${uid(3)}'`);
	expect(await recipient()).toBeNull();
	await asAdmin("update public.employees set secondary_evaluator_id = null where id = 1");
	expect(await recipient()).toBeNull();
});
it("denies unrelated users, internal functions, anonymous RPCs and missing JWT claims", async () => {
	await login(7);
	expect(await workspace()).toEqual([]);
	await expect(
		db.query("select public.reviewer_sheet_snapshot(100, 'secondary')"),
	).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role anon");
	await expect(workspace()).rejects.toMatchObject({ code: "42501" });
	await expect(recipient()).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role authenticated");
	await db.query("select set_config('request.jwt.claim.sub', '', false)");
	await expect(workspace()).rejects.toMatchObject({ code: "42501" });
});
