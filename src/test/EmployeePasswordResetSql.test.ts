import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb, rollbackAfterTest, sessionId, uid } from "./prodLikeDb";

/**
 * Admin が社員に仮のパスワードを設定する(reset_employee_password)。
 * 仮のパスワードは Admin も知っているので、本人が Auth で変えるまで DB は何も読ませない。
 * 社員 1: Admin 2: Reviewer 4: Employee 7: 未登録。どの社員も旧パスワードは OldPass1。
 */
let db: PGlite;
/** 断られた文の後も同じテストの中で読めるよう、1文ずつ savepoint で包む。 */
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
	await db.exec("savepoint statement");
	try {
		return (await db.query<T>(sql, params)).rows;
	} catch (error) {
		await db.exec("rollback to savepoint statement");
		throw error;
	}
}
const reset = (employeeNo: unknown, password: unknown) =>
	rows("select public.reset_employee_password($1, $2)", [employeeNo, password]);

/** DB の所有者として、パスワード・セッション・監査・仮パスワードの印を読む。 */
async function snapshot(employeeId = 4) {
	await db.exec("reset role");
	const [user] = await rows<{ matches_old: boolean; matches_new: boolean }>(
		`select encrypted_password = extensions.crypt('OldPass1', encrypted_password) as matches_old,
			encrypted_password = extensions.crypt('NewPass1', encrypted_password) as matches_new
		 from auth.users where id = $1`,
		[uid(employeeId)],
	);
	const [counts] = await rows<{ sessions: number; tokens: number; audits: number }>(
		`select (select count(*)::int from auth.sessions where user_id = $1) as sessions,
			(select count(*)::int from auth.refresh_tokens where user_id = $2) as tokens,
			(select count(*)::int from public.security_audit_log where action = 'employee.password_reset') as audits`,
		[uid(employeeId), uid(employeeId)],
	);
	const [employee] = await rows<{ password_change_required: boolean }>(
		"select password_change_required from public.employees where id = $1",
		[employeeId],
	);
	return { ...user, ...counts, ...employee };
}
const untouched = { matches_old: true, matches_new: false, sessions: 1, tokens: 1, audits: 0 };

beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`
		update auth.users set encrypted_password = extensions.crypt('OldPass1', extensions.gen_salt('bf', 4));
		grant usage on schema auth, extensions to supabase_auth_admin;
		grant select, update on auth.users to supabase_auth_admin;
	`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});
// 本人(社員 4)は別の PC でログインしたまま
beforeEach(async () => {
	await rollbackAfterTest(db);
	await db.query("insert into auth.sessions(id, user_id) values($1, $2)", [sessionId(4), uid(4)]);
	await db.query(
		"insert into auth.refresh_tokens(token, user_id, session_id) values('t', $1, $2)",
		[uid(4), sessionId(4)],
	);
});

it("sets a temporary password, ends the employee's sessions and records who did it", async () => {
	await actAs(db, 1);
	await reset("E4", "NewPass1");
	expect(await snapshot()).toEqual({
		matches_old: false,
		matches_new: true,
		sessions: 0,
		tokens: 0,
		audits: 1,
		password_change_required: true,
	});
	const [audit] = await rows<{ actor_user_id: string; entity_id: number; details: object }>(
		"select actor_user_id, entity_id, details from public.security_audit_log where action = 'employee.password_reset'",
	);
	expect(audit).toEqual({
		actor_user_id: uid(1),
		entity_id: 4,
		details: { employeeNo: "E4", revokedSessions: 1 },
	});
	// パスワードは監査ログのどこにも残さない(ハッシュも)
	const logged = await rows<{ text: string }>(
		"select details::text as text from public.security_audit_log",
	);
	expect(logged.map((row) => row.text).join()).not.toMatch(/NewPass1|\$2[aby]\$/);
});

it("hashes with the cost Auth uses, so sign-in strength does not drop", async () => {
	await actAs(db, 1);
	await reset("E4", "NewPass1");
	await db.exec("reset role");
	const [user] = await rows<{ prefix: string }>(
		"select left(encrypted_password, 7) as prefix from auth.users where id = $1",
		[uid(4)],
	);
	expect(user.prefix).toBe("$2a$10$");
});

it("blocks every read and write until the employee chooses their own password", async () => {
	await actAs(db, 1);
	await reset("E4", "NewPass1");
	// 仮のパスワードでログインし直しても(Admin がなりすましても)、DB は社員として扱わない
	await actAs(db, 4);
	expect(await rows("select public.current_employee_id() as id")).toEqual([{ id: null }]);
	expect(await rows("select public.get_current_employee_access_state() as state")).toEqual([
		{ state: "password_change_required" },
	]);
	expect(await rows("select employee_id from public.employee_details()")).toEqual([]);

	// 本人が Auth で変える(Auth は supabase_auth_admin として auth.users を直す)
	await db.exec("reset role; set role supabase_auth_admin");
	await db.query(
		"update auth.users set encrypted_password = extensions.crypt('Mine1234', extensions.gen_salt('bf', 4)) where id = $1",
		[uid(4)],
	);
	await actAs(db, 4);
	expect(await rows("select public.current_employee_id() as id")).toEqual([{ id: 4 }]);
	expect(await rows("select public.get_current_employee_access_state() as state")).toEqual([
		{ state: "enabled" },
	]);
});

it("keeps a suspended employee reported as suspended", async () => {
	await actAs(db, 1);
	await reset("E4", "NewPass1");
	await db.exec("reset role; update public.employees set is_enabled = false where id = 4");
	await actAs(db, 4);
	expect(await rows("select public.get_current_employee_access_state() as state")).toEqual([
		{ state: "disabled" },
	]);
});

it("does not let other Auth changes (email, sign-in time) lift the requirement", async () => {
	await actAs(db, 1);
	await reset("E4", "NewPass1");
	await db.exec("reset role");
	await db.query("update auth.users set updated_at = now(), email = email where id = $1", [uid(4)]);
	expect((await snapshot()).password_change_required).toBe(true);
});

it.each([
	["a Reviewer", 2],
	["an Employee", 4],
	["an account without an employee", 99],
	["an anonymous caller", 0],
])("refuses %s and changes nothing", async (_who, id) => {
	await actAs(db, id);
	await expect(reset(id === 4 ? "E5" : "E4", "NewPass1")).rejects.toMatchObject({
		code: "42501",
	});
	expect(await snapshot()).toEqual({ ...untouched, password_change_required: false });
});

it("refuses a suspended Admin and an Admin still on a temporary password", async () => {
	await db.exec("reset role; update public.employees set is_enabled = false where id = 1");
	await actAs(db, 1);
	await expect(reset("E4", "NewPass1")).rejects.toMatchObject({ code: "42501" });
	await db.exec(
		"reset role; update public.employees set is_enabled = true, password_change_required = true where id = 1",
	);
	await actAs(db, 1);
	await expect(reset("E4", "NewPass1")).rejects.toMatchObject({ code: "42501" });
	expect(await snapshot()).toEqual({ ...untouched, password_change_required: false });
});

it("does not let an Admin reset their own password", async () => {
	await actAs(db, 1);
	await expect(reset("E1", "NewPass1")).rejects.toMatchObject({ code: "42501" });
	expect((await snapshot(1)).matches_old).toBe(true);
});

it.each([
	["an unregistered employee", "update public.employees set user_id = null where id = 4"],
	["a suspended employee", "update public.employees set is_enabled = false where id = 4"],
	["an unknown employee number", "update public.employees set employee_no = 'E4-old' where id = 4"],
])("refuses %s (the screen was stale) and changes nothing", async (_case, change) => {
	await db.exec(`reset role; ${change}`);
	await actAs(db, 1);
	await expect(reset("E4", "NewPass1")).rejects.toMatchObject({ code: "23514" });
	expect(await snapshot()).toMatchObject(untouched);
});

it.each([
	["missing", null],
	["too short", "Ab1"],
	["without a capital", "newpass1"],
	["without a lowercase letter", "NEWPASS1"],
	["without a digit", "NewPassword"],
	["longer than Auth accepts", `Aa1${"x".repeat(70)}`],
])("refuses a password that is %s and changes nothing", async (_case, password) => {
	await actAs(db, 1);
	await expect(reset("E4", password)).rejects.toMatchObject({ code: "22023" });
	expect(await snapshot()).toEqual({ ...untouched, password_change_required: false });
});

it("rolls everything back when the audit record cannot be written", async () => {
	await db.exec(`
		reset role;
		create function public.refuse_audit() returns trigger language plpgsql as
		$$ begin raise exception 'audit store unavailable'; end $$;
		create trigger refuse_audit before insert on public.security_audit_log
		for each row execute function public.refuse_audit();
	`);
	await actAs(db, 1);
	await expect(reset("E4", "NewPass1")).rejects.toThrow("audit store unavailable");
	expect(await snapshot()).toEqual({ ...untouched, password_change_required: false });
});

it("leaves no way around the function", async () => {
	await actAs(db, 1);
	// Admin でも、Auth のパスワードやセッションを直接は触れない
	await expect(
		rows("update auth.users set encrypted_password = 'x' where id = $1", [uid(4)]),
	).rejects.toMatchObject({ code: "42501" });
	await expect(rows("delete from auth.sessions")).rejects.toMatchObject({ code: "42501" });
	// 仮パスワードの印も、表の直接更新では付け外しできない(本人も Admin も)
	await expect(
		rows("update public.employees set password_change_required = true where id = 4"),
	).rejects.toMatchObject({ code: "42501" });
	await reset("E4", "NewPass1");
	await actAs(db, 4);
	await expect(
		rows("update public.employees set password_change_required = false where id = 4"),
	).rejects.toMatchObject({ code: "42501" });
	await db.exec("reset role");
	expect((await snapshot()).password_change_required).toBe(true);
});
