import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const migration = readFileSync(
	new URL("../../supabase/migrations/202610080003_employee_roles.sql", import.meta.url),
	"utf8",
);
const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
const login = async (id: number) => {
	await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid(id)]);
};
const setRole = async (employeeNo: string, role: string) =>
	(
		await db.query<{ changed: boolean }>("select public.set_employee_role($1, $2) as changed", [
			employeeNo,
			role,
		])
	).rows[0].changed;
const roles = async () =>
	Object.fromEntries(
		(
			await db.query<{ employee_no: string; role_name: string }>(
				"select e.employee_no, r.role_name from public.employees e join public.roles r on r.id = e.role_id order by e.id",
			)
		).rows.map((row) => [row.employee_no, row.role_name]),
	);

beforeAll(async () => {
	db = await PGlite.create();
	await db.exec(`
		create role anon; create role authenticated; create schema auth;
		create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
		create table public.roles (id integer primary key, role_name text);
		create table public.employees (id integer primary key, user_id uuid, name text, employee_no text, role_id integer, career_course text, primary_evaluator_id integer, secondary_evaluator_id integer, grade_id smallint, no_secondary_evaluator boolean default false);
		insert into public.roles values (1, 'Admin'), (2, 'Reviewer'), (3, 'Employee');
		insert into public.employees (id, user_id, name, employee_no, role_id)
		select id, ('00000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid, '社員' || id, 'E00' || id, 3 from generate_series(1, 4) id;
		-- Supabase と同じく、クライアントのロールは既定で表全体を更新できる
		grant select, update on public.employees, public.roles to anon, authenticated;
	`);
	await db.exec(migration);
	await db.exec(migration);
}, 30_000);
beforeEach(async () => {
	// 1: Admin, 2: Reviewer, 3・4: Employee
	await db.exec(
		"reset role; update public.employees set role_id = case id when 1 then 1 when 2 then 2 else 3 end; set role authenticated;",
	);
	await login(1);
});
afterAll(async () => {
	await db?.close();
});

it("lets an Admin change roles, and reports an unknown employee or role", async () => {
	expect(await setRole("E003", "Reviewer")).toBe(true);
	expect(await setRole("E002", "Employee")).toBe(true);
	expect(await roles()).toEqual({
		E001: "Admin",
		E002: "Employee",
		E003: "Reviewer",
		E004: "Employee",
	});
	expect(await setRole("E999", "Reviewer")).toBe(false);
	await expect(setRole("E003", "Owner")).rejects.toMatchObject({ code: "22023" });
});
it("never demotes the last Admin, but allows it once another Admin exists", async () => {
	await expect(setRole("E001", "Reviewer")).rejects.toMatchObject({ code: "23514" });
	expect(await setRole("E001", "Admin")).toBe(true);
	expect(await setRole("E004", "Admin")).toBe(true);
	expect(await setRole("E001", "Employee")).toBe(true);
	// 残った Admin(4) が最後の一人になる
	await login(4);
	await expect(setRole("E004", "Employee")).rejects.toMatchObject({ code: "23514" });
	expect(await roles()).toMatchObject({ E001: "Employee", E004: "Admin" });
});
it("denies everyone but an Admin, including a demoted Admin, anonymous and missing JWT claims", async () => {
	for (const id of [2, 3]) {
		await login(id);
		await expect(setRole(`E00${id}`, "Admin")).rejects.toMatchObject({ code: "42501" });
	}
	await db.query("select set_config('request.jwt.claim.sub', '', false)");
	await expect(setRole("E003", "Admin")).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role anon");
	await expect(setRole("E003", "Admin")).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role authenticated");
	expect(await roles()).toMatchObject({ E002: "Reviewer", E003: "Employee" });
});
it("blocks direct role updates from clients while other columns stay updatable", async () => {
	// 自分を Admin にする直接更新は、Admin 本人であっても関数を通さない限りできない
	for (const id of [1, 3]) {
		await login(id);
		await expect(
			db.exec("update public.employees set role_id = 1 where id = 3"),
		).rejects.toMatchObject({ code: "42501" });
	}
	await db.exec("reset role; set role anon");
	await expect(
		db.exec("update public.employees set role_id = 1 where id = 3"),
	).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role; set role authenticated");
	// 評価者・等級・登録の紐付けなど、アプリが直接更新している列はそのまま
	await db.exec(
		"update public.employees set grade_id = 2, primary_evaluator_id = 1, secondary_evaluator_id = null, no_secondary_evaluator = true, user_id = user_id where id = 3",
	);
	expect(await roles()).toMatchObject({ E003: "Employee" });
});
