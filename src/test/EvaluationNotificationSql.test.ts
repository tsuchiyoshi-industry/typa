import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const migration = [
	"202610050001_evaluation_notification_recipients.sql",
	"202610060001_no_secondary_evaluator.sql",
]
	.map((file) =>
		readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"),
	)
	.join("\n");
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon;
		create role authenticated;
		create schema auth;
		create function auth.uid() returns uuid language sql stable as
		$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
		create table public.employees (id integer primary key, user_id uuid, primary_evaluator_id integer, secondary_evaluator_id integer);
		create table public.evaluation_sheets (id bigint primary key, employee_id bigint, status text);
		insert into auth.users
		select ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
		       'employee' || id || '@example.jp', now() from generate_series(1, 8) as id;
		insert into public.employees (id, user_id, primary_evaluator_id, secondary_evaluator_id)
		select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, 2, 3 from generate_series(1, 8) as id;
		update public.employees set primary_evaluator_id = null where id = 5;
		update public.employees set primary_evaluator_id = 3 where id = 6;
		update public.employees set secondary_evaluator_id = 7 where id = 7;
		update public.employees set secondary_evaluator_id = null where id in (4, 8);
		insert into public.evaluation_sheets values (100, 1, 'finalized'), (101, 1, 'submitted'), (104, 4, 'finalized'), (105, 5, 'finalized'), (106, 6, 'finalized'), (107, 7, 'finalized'), (108, 8, 'finalized');
	`);
	await db.exec(migration);
	// Re-applying the migration preserves the same explicit permissions.
	await db.exec(migration);
	// 4 は二次評価者「なし」と明示、8 は未設定(指定待ち)のまま
	await db.exec("update public.employees set no_secondary_evaluator = true where id = 4");
}, 30_000);
beforeEach(async () => {
	await db.exec("reset role; update auth.users set email_confirmed_at = now();");
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(3)]);
	await db.exec("set role authenticated");
});
afterAll(async () => {
	await db?.close();
});
const recipients = (sheetId = 100) =>
	db.query("select * from public.get_finalized_sheet_notification_recipients($1)", [sheetId]);

it("executes the actual migration and returns only the two evaluator Auth emails", async () => {
	expect((await recipients()).rows).toEqual([
		{ role: "primary", employee_id: 2, email: "employee2@example.jp" },
		{ role: "secondary", employee_id: 3, email: "employee3@example.jp" },
	]);
});
it.each([1, 2, 4])(
	"denies recipient lookup by subject/primary/unrelated employee %s",
	async (id) => {
		await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(id)]);
		await expect(recipients()).rejects.toMatchObject({ code: "42501" });
	},
);
it("denies anonymous execution and authenticated calls without a JWT user", async () => {
	await db.exec("reset role; set role anon");
	await expect(recipients()).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role authenticated");
	await db.query("select set_config('request.jwt.claim.sub', '', false)");
	await expect(recipients()).rejects.toMatchObject({ code: "42501" });
});
it.each([101, 999])("denies unfinalized or nonexistent sheet %s", async (id) => {
	await expect(recipients(id)).rejects.toMatchObject({ code: "42501" });
});
it("does not disclose unverified Auth email", async () => {
	await db.exec(
		"reset role; update auth.users set email_confirmed_at = null where email = 'employee2@example.jp'; set role authenticated",
	);
	expect((await recipients()).rows[0]).toEqual({ role: "primary", employee_id: 2, email: null });
});
it("preserves missing evaluator assignments", async () => {
	expect((await recipients(105)).rows[0]).toEqual({
		role: "primary",
		employee_id: null,
		email: null,
	});
});
it("lets the primary evaluator act as final evaluator only when secondary is explicitly none", async () => {
	await expect(recipients(104)).rejects.toMatchObject({ code: "42501" });
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(2)]);
	expect((await recipients(104)).rows).toEqual([
		{ role: "primary", employee_id: 2, email: "employee2@example.jp" },
		{ role: "secondary", employee_id: null, email: null },
	]);
	// 二次評価者がいるシート、未設定なだけのシートでは、一次評価者は照会できない
	await expect(recipients(100)).rejects.toMatchObject({ code: "42501" });
	await expect(recipients(108)).rejects.toMatchObject({ code: "42501" });
});
it("rejects marking none while a secondary evaluator is assigned", async () => {
	await db.exec("reset role");
	await expect(
		db.exec("update public.employees set no_secondary_evaluator = true where id = 1"),
	).rejects.toMatchObject({ code: "23514" });
});
it("handles one employee assigned to both evaluator roles", async () => {
	expect((await recipients(106)).rows).toEqual([
		{ role: "primary", employee_id: 3, email: "employee3@example.jp" },
		{ role: "secondary", employee_id: 3, email: "employee3@example.jp" },
	]);
});
it("denies self-evaluation even when an employee is assigned as their own secondary", async () => {
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(7)]);
	await expect(recipients(107)).rejects.toMatchObject({ code: "42501" });
});
