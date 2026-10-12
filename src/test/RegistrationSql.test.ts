import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

const DENIED = { code: "42501" };
let db: PGlite;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await db.query<{ value: T }>(`select ${sql} as value`, params)).rows[0].value;
const asOwner = async <T>(sql: string) => {
	await db.exec("reset role");
	return (await db.query<T>(sql)).rows;
};
/** 共有PCのメール(98)に届いた認証コードでログインして、社員番号の登録を始める。 */
const begin = async (employeeNo: string) => {
	await actAs(db, 98, "otp");
	return value<{ status: string; token?: string }>("public.begin_registration($1)", [employeeNo]);
};
const complete = (token: string) => value<boolean>("public.complete_registration($1)", [token]);
/** 社員 E7 のログイン用アカウント(97)。アプリが登録の途中で作る。 */
const createLoginAccount = () =>
	db.query("insert into auth.users (id, email) values ($1, 'typa-e7@example.jp')", [uid(97)]);

beforeAll(async () => {
	db = await createProdLikeDb("202610120003_z");
}, 60_000);
beforeEach(async () => {
	await db.exec("reset role");
	await db.exec(`
		delete from public.registration_tickets;
		delete from public.employee_contacts where employee_id = 7;
		update public.employees set user_id = null where id = 7;
		delete from auth.users where email = 'typa-e7@example.jp';
	`);
	await createLoginAccount();
});
afterAll(async () => {
	await db?.close();
});

it("links an employee only to their own login account, with the ticket of a verified company mailbox", async () => {
	const started = await begin("E7");
	expect(started.status).toBe("available");
	const token = started.token as string;

	// 別の社員番号のアカウントや、トークンを知らないアカウントでは完了できない
	await actAs(db, 99);
	expect(await complete(token)).toBe(false);
	await actAs(db, 97);
	expect(await complete(uid(1))).toBe(false);
	expect(await complete(token)).toBe(true);
	expect(await complete(token)).toBe(false);

	expect(
		await asOwner(
			"select e.user_id, c.email from public.employees e join public.employee_contacts c on c.employee_id = e.id where e.id = 7",
		),
	).toEqual([{ user_id: uid(97), email: "shared-pc@example.jp" }]);
	expect(await asOwner("select 1 from public.registration_tickets")).toEqual([]);
	expect(await begin("E7")).toEqual({ status: "registered" });
});

it("tells a registered number from an unknown one, and lets an expired ticket lapse", async () => {
	expect(await begin("E4")).toEqual({ status: "registered" });
	expect(await begin("NOPE")).toEqual({ status: "missing" });
	const { token } = await begin("E7");
	await asOwner("update public.registration_tickets set expires_at = now() - interval '1 second'");
	await actAs(db, 97);
	expect(await complete(token as string)).toBe(false);
	// 登録をやり直すと、前のトークンは使えなくなる
	const first = (await begin("E7")).token as string;
	const second = (await begin("E7")).token as string;
	await actAs(db, 97);
	expect(await complete(first)).toBe(false);
	expect(await complete(second)).toBe(true);
});

it("starts a sign-up only for a session that read a company mailbox", async () => {
	const start = () => db.query("select public.begin_registration('E7')");
	// パスワードでログインしただけ(メールを読めることを示していない)
	await actAs(db, 98, "password");
	await expect(start()).rejects.toMatchObject(DENIED);
	// ログイン用アドレスは会社ドメインだが、メールは届かない
	await actAs(db, 99, "otp");
	await expect(start()).rejects.toMatchObject(DENIED);
	await asOwner(
		"update auth.users set email = 'someone@other.example' where email = 'shared-pc@example.jp'",
	);
	await actAs(db, 98, "otp");
	await expect(start()).rejects.toMatchObject(DENIED);
	await asOwner(
		"update auth.users set email = 'shared-pc@example.jp' where email = 'someone@other.example'",
	);
	await actAs(db, 0);
	await expect(start()).rejects.toMatchObject(DENIED);
	// 会社ドメインが未設定なら、誰も始められない
	await asOwner("update public.workspace_settings set required_domain = ''");
	await actAs(db, 98, "otp");
	await expect(start()).rejects.toMatchObject(DENIED);
	await asOwner("update public.workspace_settings set required_domain = 'example.jp'");
});

it("resets a registration with everything it left behind, for an Admin only", async () => {
	const reset = (employeeNo: string) =>
		value<boolean>("public.reset_employee_registration($1)", [employeeNo]);
	const { token } = await begin("E7");
	await actAs(db, 97);
	await complete(token as string);

	await actAs(db, 2);
	await expect(reset("E7")).rejects.toMatchObject(DENIED);
	await actAs(db, 1);
	await expect(reset("E1")).rejects.toMatchObject(DENIED);
	expect(await reset("NOPE")).toBe(false);
	expect(await reset("E7")).toBe(true);
	expect(await reset("E7")).toBe(false);
	expect(
		await asOwner(
			"select (select user_id from public.employees where id = 7) as user_id, (select count(*)::int from public.employee_contacts where employee_id = 7) as contacts, (select count(*)::int from auth.users where email = 'typa-e7@example.jp') as accounts",
		),
	).toEqual([{ user_id: null, contacts: 0, accounts: 0 }]);

	// 紐付けの前で止まったアカウントだけが残っていても、取り消せる
	await createLoginAccount();
	await begin("E7");
	await actAs(db, 1);
	expect(await reset("E7")).toBe(true);
	expect(
		await asOwner(
			"select (select count(*)::int from auth.users where email = 'typa-e7@example.jp') as accounts, (select count(*)::int from public.registration_tickets) as tickets",
		),
	).toEqual([{ accounts: 0, tickets: 0 }]);
});

/** 評価の中身は問わず、シート 900 の状態だけを進める。 */
const forceStatus = async (status: string) => {
	await db.exec("reset role");
	await db.exec(`
		alter table public.evaluation_sheets disable trigger user;
		update public.evaluation_sheets set status = '${status}' where id = 900;
		alter table public.evaluation_sheets enable trigger user;
	`);
};

it("sends notifications to the verified mailbox, not to what the account says about itself", async () => {
	await db.exec("reset role");
	await db.exec(`
		update auth.users set raw_user_meta_data = '{"contact_email": "attacker@other.example"}' where id = '${uid(2)}';
		insert into public.evaluation_sheets (id, period_id, employee_id, status) values (900, 1, 4, 'submitted');
	`);
	await actAs(db, 4);
	expect(await value("public.get_submitted_sheet_notification_recipient(900)")).toBe(
		"person2@example.jp",
	);
	await forceStatus("first_evaluated");
	await actAs(db, 2);
	expect(await value("public.get_first_evaluated_sheet_notification_recipient(900)")).toBe(
		"person3@example.jp",
	);
	await forceStatus("finalized");
	await actAs(db, 3);
	expect(
		(await db.query("select * from public.get_finalized_sheet_notification_recipients(900)")).rows,
	).toEqual([
		{ role: "primary", employee_id: 2, email: "person2@example.jp" },
		{ role: "secondary", employee_id: 3, email: "person3@example.jp" },
	]);
	// 連絡先は、クライアントからは読めない
	await expect(db.query("select * from public.employee_contacts")).rejects.toMatchObject(DENIED);
	await expect(db.query("select * from public.registration_tickets")).rejects.toMatchObject(DENIED);
});

it("creates accounts only for company mailboxes and for sign-ups in progress", async () => {
	const allowed = async (email: string) => {
		await db.exec("reset role");
		const result = await value<{ error?: { http_code: number } }>(
			"public.hook_before_user_created($1::jsonb)",
			[JSON.stringify({ user: { email } })],
		);
		return result.error === undefined;
	};
	expect(await allowed("Shared-PC@example.jp")).toBe(true);
	expect(await allowed("someone@other.example")).toBe(false);
	expect(await allowed("someone@evil-example.jp")).toBe(false);
	expect(await allowed("")).toBe(false);
	expect(await allowed("typa-e7@example.jp")).toBe(false);
	await begin("E7");
	expect(await allowed("typa-e7@example.jp")).toBe(true);
	expect(await allowed("typa-e5@example.jp")).toBe(false);
	// 利用者は呼べない
	await actAs(db, 1);
	await expect(
		db.query(`select public.hook_before_user_created('{"user":{"email":"a@example.jp"}}'::jsonb)`),
	).rejects.toMatchObject(DENIED);
});
