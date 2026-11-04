import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, onTestFinished } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

// 認証コード・通知の送り先は、会社ドメインに縛らない(どのドメインのメールアドレスでもよい)。
// 会社ドメイン(workspace_settings.required_domain)は、ログイン用の内部アドレス
// typa-<社員番号>@<会社ドメイン> にだけ使う。内部アドレスのアカウントは、登録の途中でしか作れない。

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await query<{ v: T }>(`select ${sql} as v`, params))[0]?.v as T;
const DENIED = { code: "42501" };
/** Auth がこのアドレスのアカウントを作ってよいか(Before User Created フック)。 */
const allowed = async (email: string) => {
	await db.exec("reset role");
	const result = await value<{ error?: { http_code: number } }>(
		"public.hook_before_user_created($1::jsonb)",
		[JSON.stringify({ user: { email } })],
	);
	return result.error === undefined;
};
/** 社員 E7 の招待コードを発行し、アカウント 98(認証コードでログインした)で登録を始める。 */
const begin = async () => {
	await actAs(db, 1);
	const invite = await value<{ code: string }>("public.issue_employee_invitation('E7')");
	await actAs(db, 98, "otp");
	return value<{ status: string; token?: string }>("public.begin_registration('E7',$1)", [
		invite.code,
	]);
};
/** アカウント 98 のメールアドレスを、このテストの間だけ替える。 */
const mailboxOf98 = async (email: string) => {
	await db.exec("reset role");
	await query("update auth.users set email = $1 where id = $2", [email, uid(98)]);
	onTestFinished(async () => {
		await db.exec("reset role");
		await query("update auth.users set email = 'shared-pc@example.jp' where id = $1", [uid(98)]);
	});
};

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
beforeEach(async () => {
	await db.exec(
		"reset role; delete from public.employee_invitations where employee_id=7; delete from public.registration_tickets where employee_id=7;",
	);
});
afterAll(async () => {
	await db?.close();
});

it("lets Auth create an account for a mailbox at any domain", async () => {
	expect(await allowed("Shared-PC@example.jp")).toBe(true);
	expect(await allowed("someone@other.example")).toBe(true);
	expect(await allowed("taro.yamada@gmail.com")).toBe(true);
	// 内部アドレスの形でも、会社ドメインでなければただのメールアドレス
	expect(await allowed("typa-e7@other.example")).toBe(true);
	expect(await allowed("")).toBe(false);
	expect(await allowed("not-an-address")).toBe(false);
});

it("still creates a login address only for a sign-up in progress", async () => {
	expect(await allowed("typa-e7@example.jp")).toBe(false);
	expect(await allowed("TYPA-E7@EXAMPLE.JP")).toBe(false);
	expect((await begin()).status).toBe("available");
	expect(await allowed("typa-e7@example.jp")).toBe(true);
	// 登録を始めていない社員の内部アドレスは作れない
	expect(await allowed("typa-e5@example.jp")).toBe(false);
});

it("starts a sign-up from a mailbox at another domain, and sends notices there", async () => {
	await mailboxOf98("someone@other.example");
	const started = await begin();
	expect(started.status).toBe("available");
	await db.exec("reset role");
	expect(
		await query("select contact_email from public.registration_tickets where employee_id = 7"),
	).toEqual([{ contact_email: "someone@other.example" }]);
});

it("does not start a sign-up from a login address, a password session or an old code", async () => {
	await actAs(db, 1);
	const invite = await value<{ code: string }>("public.issue_employee_invitation('E7')");
	const start = () => query("select public.begin_registration('E7',$1)", [invite.code]);
	// 99 のアドレスは内部アドレス(メールは届かない)
	await actAs(db, 99, "otp");
	await expect(start()).rejects.toMatchObject(DENIED);
	// パスワードでログインしただけでは、メールを読めることを示していない
	await actAs(db, 98, "password");
	await expect(start()).rejects.toMatchObject(DENIED);
	await actAs(db, 98, "otp");
	await query("select set_config('request.jwt.claims',$1,false)", [
		JSON.stringify({ amr: [{ method: "otp", timestamp: 0 }] }),
	]);
	await expect(start()).rejects.toMatchObject(DENIED);
	await actAs(db, 0);
	await expect(start()).rejects.toThrow();
});

it("lets nobody register while the company domain for login addresses is unset", async () => {
	await db.exec("reset role; update public.workspace_settings set required_domain = ''");
	onTestFinished(async () => {
		await db.exec(
			"reset role; update public.workspace_settings set required_domain = 'example.jp'",
		);
	});
	expect(await allowed("someone@other.example")).toBe(false);
	await actAs(db, 98, "otp");
	await expect(query("select public.begin_registration('E7','X')")).rejects.toMatchObject(DENIED);
});
