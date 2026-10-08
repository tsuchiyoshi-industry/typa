import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const migration = readFileSync(
	new URL("../../supabase/migrations/202610080013_workspace_settings.sql", import.meta.url),
	"utf8",
);
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
const login = (id: number) =>
	db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(id)]);
const asOwner = (sql: string) => db.exec(`reset role; ${sql}; set role authenticated;`);
const smtp = async () =>
	(await db.query<{ data: unknown }>("select public.get_notification_smtp_settings() as data"))
		.rows[0].data;
const saved = {
	host: "smtp.example.jp",
	port: 587,
	user: "support@example.jp",
	password: "synthetic-password",
};

// 1: Admin(評価はしない) 2: 一次評価者 3: 二次評価者 4: 評価される本人 5: 無関係の社員
beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated; create schema auth;
		create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table auth.users (id uuid primary key, email text);
		create table public.roles (id smallint primary key, role_name text);
		insert into public.roles values (1, 'Employee'), (2, 'Reviewer'), (3, 'Admin');
		create table public.employees (id integer primary key, user_id uuid, role_id smallint default 1 references public.roles(id));
		grant select on public.employees, public.roles to authenticated;
		create table public.evaluation_sheets (id bigint primary key, employee_id integer, primary_evaluator_id integer, secondary_evaluator_id integer);
		insert into auth.users
		select ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, 'typa-e' || id || '@example.jp' from generate_series(1, 5) id;
		-- 認証コードの確認だけで止まったアカウントは、会社ドメインの判定に使わない
		insert into auth.users values ('00000000-0000-0000-0000-000000000099', 'someone@other.example');
		insert into public.employees (id, user_id)
		select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid from generate_series(1, 5) id;
		update public.employees set role_id = 3 where id = 1;
		insert into public.evaluation_sheets values (100, 4, 2, 3);
	`);
	await db.exec(migration);
	await db.exec(
		"update public.workspace_settings set smtp_host = 'smtp.example.jp', smtp_user = 'support@example.jp', smtp_password = 'synthetic-password'",
	);
	// 再適用しても、登録済みの設定と権限は変わらない
	await db.exec(migration);
}, 30_000);
beforeEach(async () => {
	await db.exec("reset role");
	await login(1);
	await db.exec("set role authenticated");
});
afterAll(async () => {
	await db?.close();
});

it("takes the company domain from the registered accounts and serves it before sign-in", async () => {
	await db.exec("reset role; set role anon");
	expect((await db.query("select public.get_required_domain() as domain")).rows).toEqual([
		{ domain: "example.jp" },
	]);
	// ドメインのほかは、ログイン前には何も読めない
	await expect(db.query("select smtp_host from public.workspace_settings")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(smtp()).rejects.toMatchObject({ code: "42501" });
});
it.each([2, 3])("gives the SMTP account to evaluator %s of a sheet", async (id) => {
	await login(id);
	expect(await smtp()).toEqual(saved);
});
it.each([1, 4, 5])(
	"does not give the SMTP password to employee %s who evaluates no sheet",
	async (id) => {
		await login(id);
		await expect(smtp()).rejects.toMatchObject({ code: "42501" });
	},
);
it("never returns the password from the table, not even to an Admin", async () => {
	expect(
		(
			await db.query(
				"select smtp_host, smtp_port, smtp_user, smtp_password_set from public.workspace_settings",
			)
		).rows,
	).toEqual([
		{
			smtp_host: "smtp.example.jp",
			smtp_port: 587,
			smtp_user: "support@example.jp",
			smtp_password_set: true,
		},
	]);
	await expect(
		db.query("select smtp_password from public.workspace_settings"),
	).rejects.toMatchObject({ code: "42501" });
});
it.each([2, 4])("hides the settings from non-Admin %s and ignores their update", async (id) => {
	await login(id);
	expect((await db.query("select smtp_host from public.workspace_settings")).rows).toEqual([]);
	expect(
		(
			await db.query(
				"update public.workspace_settings set smtp_host = 'evil.example' where id returning id",
			)
		).rows,
	).toEqual([]);
});
it("lets an Admin change the sender, keeping the password unless a new one is given", async () => {
	try {
		expect(
			(
				await db.query(
					"update public.workspace_settings set smtp_user = 'new@example.jp', smtp_port = 2525 where id returning id",
				)
			).rows,
		).toHaveLength(1);
		await login(2);
		expect(await smtp()).toEqual({ ...saved, user: "new@example.jp", port: 2525 });
	} finally {
		await asOwner(
			"update public.workspace_settings set smtp_user = 'support@example.jp', smtp_port = 587",
		);
	}
});
it("keeps the company domain out of reach of clients, and the row single and valid", async () => {
	// 変えると登録済みの全員がログインできなくなるので、画面からは変えさせない
	await expect(
		db.query("update public.workspace_settings set required_domain = 'other.example'"),
	).rejects.toMatchObject({ code: "42501" });
	await expect(
		db.query("insert into public.workspace_settings (id) values (true)"),
	).rejects.toMatchObject({ code: "42501" });
	await expect(db.query("delete from public.workspace_settings")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(
		db.query("update public.workspace_settings set smtp_port = 70000 where id"),
	).rejects.toMatchObject({ code: "23514" });
});

// 提出の通知(202610080015)。上のテストの後に適用する: 適用すると、評価される本人も SMTP 設定を読める
it("lets the subject of a submitted sheet notify the primary evaluator", async () => {
	await db.exec(`reset role;
		alter table auth.users add column email_confirmed_at timestamptz default now(), add column raw_user_meta_data jsonb;
		update auth.users set raw_user_meta_data = jsonb_build_object('contact_email', 'contact-' || email);
		alter table public.evaluation_sheets add column status text default 'submitted';
	`);
	const submission = readFileSync(
		new URL("../../supabase/migrations/202610080015_submission_notification.sql", import.meta.url),
		"utf8",
	);
	await db.exec(submission);
	await db.exec(submission);
	await db.exec("set role authenticated");
	const recipient = () =>
		db.query("select public.get_submitted_sheet_notification_recipient(100) as email");

	await login(4);
	expect((await recipient()).rows).toEqual([{ email: "contact-typa-e2@example.jp" }]);
	expect(await smtp()).toEqual(saved);
	// 評価者や無関係の社員は、提出の通知先を引けない。シートのない社員は SMTP 設定も読めない
	for (const id of [2, 5]) {
		await login(id);
		await expect(recipient()).rejects.toMatchObject({ code: "42501" });
	}
	await expect(smtp()).rejects.toMatchObject({ code: "42501" });
	// 提出済みでなくなったシートでは引けない
	await db.exec(
		"reset role; update public.evaluation_sheets set status = 'first_evaluated'; set role authenticated",
	);
	await login(4);
	await expect(recipient()).rejects.toMatchObject({ code: "42501" });
});
