import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const migration = readFileSync(
	new URL(
		"../../supabase/migrations/202610060002_reset_employee_registration.sql",
		import.meta.url,
	),
	"utf8",
);
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
const actAs = async (id: number | null) => {
	await db.exec("reset role");
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ? uid(id) : ""]);
	await db.exec("set role authenticated");
};
const reset = (employeeNo: string) =>
	db.query<{ done: boolean }>("select public.reset_employee_registration($1) as done", [
		employeeNo,
	]);
const state = async () => {
	await db.exec("reset role");
	const linked = await db.query<{ employee_no: string }>(
		"select employee_no from public.employees where user_id is not null order by id",
	);
	const users = await db.query<{ n: number }>("select count(*)::int as n from auth.users");
	return { linked: linked.rows.map((row) => row.employee_no), users: users.rows[0].n };
};

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon;
		create role authenticated;
		create schema auth;
		create function auth.uid() returns uuid language sql stable as
		$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table auth.users (id uuid primary key);
		create table public.roles (id integer primary key, role_name text);
		create table public.employees (id integer primary key, user_id uuid, employee_no text, role_id integer);
		insert into public.roles values (1, 'Admin'), (2, 'Reviewer'), (3, 'Employee');
	`);
	await db.exec(migration);
	// Re-applying the migration preserves the same explicit permissions.
	await db.exec(migration);
}, 30_000);
// 1: Admin、2: Reviewer、3: Employee(いずれも登録済み)、4: 未登録の社員
beforeEach(async () => {
	await db.exec(`
		reset role;
		delete from public.employees;
		delete from auth.users;
		insert into auth.users select ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid
		from generate_series(1, 3) as id;
		insert into public.employees
		select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, 'E' || id, id
		from generate_series(1, 3) as id;
		insert into public.employees values (4, null, 'E4', 3);
	`);
});
afterAll(async () => {
	await db?.close();
});

it("lets an Admin clear the link and delete the Auth user, keeping the employee row", async () => {
	await actAs(1);
	expect((await reset("E3")).rows[0].done).toBe(true);
	expect(await state()).toEqual({ linked: ["E1", "E2"], users: 2 });
	const rows = await db.query<{ n: number }>("select count(*)::int as n from public.employees");
	expect(rows.rows[0].n).toBe(4);
});
it.each([2, 3, null])("denies a non-Admin caller %s", async (id) => {
	await actAs(id);
	await expect(reset("E1")).rejects.toMatchObject({ code: "42501" });
	expect(await state()).toEqual({ linked: ["E1", "E2", "E3"], users: 3 });
});
it("denies anonymous execution", async () => {
	await db.exec("reset role; set role anon");
	await expect(reset("E3")).rejects.toMatchObject({ code: "42501" });
});
it("does not let an Admin reset their own registration", async () => {
	await actAs(1);
	await expect(reset("E1")).rejects.toMatchObject({ code: "42501" });
	expect(await state()).toEqual({ linked: ["E1", "E2", "E3"], users: 3 });
});
it.each(["E4", "E999"])("returns false when there is nothing to reset for %s", async (no) => {
	await actAs(1);
	expect((await reset(no)).rows[0].done).toBe(false);
	expect(await state()).toEqual({ linked: ["E1", "E2", "E3"], users: 3 });
});
