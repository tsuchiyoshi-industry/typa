import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actAs, applyMigrations, createProdLikeDb, uid } from "./prodLikeDb";

// 登録は、どのドメインのメールアドレスにも認証コードを送れる(会社のメールを持たない社員がいる)。
// そのため Auth には、社員に紐付かないアカウントができる: 認証コードを受け取ったメールのアカウント、
// 打ち間違えたアドレスのアカウント、紐付けの前で止まったログイン用アカウント。
// どれも何も読めず何も変えられないこと、用が済んだら・古くなったら残さないことを確かめる。

const MIGRATION = "202611200001_remove_unlinked_auth_accounts.sql";
const DENIED = { code: "42501" };
let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await rows<{ v: T }>(`select ${sql} as v`, params))[0]?.v as T;

/** Auth のアカウント。age は作ってからの時間(Postgres の interval)。 */
const account = async (id: number, email: string, age = "0 seconds") => {
	await db.exec("reset role");
	await rows(
		"insert into auth.users (id, email, created_at) values ($1, $2, now() - $3::interval)",
		[uid(id), email, age],
	);
};
const accounts = async () => {
	await db.exec("reset role");
	return (await rows<{ email: string }>("select email from auth.users order by email")).map(
		(row) => row.email,
	);
};
const audits = async () => {
	await db.exec("reset role");
	return rows(
		"select actor_user_id, action, entity_id, details from public.security_audit_log where action like 'account.%'",
	);
};

/** 社員の登録を、認証コードを受け取ったアカウント mailbox で始める。 */
const begin = async (employeeNo: string, mailbox = 98) => {
	await actAs(db, 1);
	const invite = await value<{ code: string }>("public.issue_employee_invitation($1)", [
		employeeNo,
	]);
	await actAs(db, mailbox, "otp");
	return value<{ status: string; token: string }>("public.begin_registration($1, $2)", [
		employeeNo,
		invite.code,
	]);
};
/** アプリが作ったログイン用アカウント(97: typa-e7)で、登録を終える。 */
const complete = async (token: string) => {
	await account(97, "typa-e7@example.jp");
	await actAs(db, 97);
	return value<boolean>("public.complete_registration($1)", [token]);
};

beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`reset role;
		update public.workspace_settings set required_domain = 'example.jp';
		insert into public.employees (id, name, employee_no, role_id, grade_id) values (8, '社員8', 'E8', 1, 1);`);
}, 60_000);
beforeEach(async () => {
	await db.exec(`reset role;
		delete from public.registration_tickets;
		delete from public.employee_invitations;
		delete from public.employee_contacts where employee_id in (7, 8);
		update public.employees set user_id = null where id in (7, 8);
		delete from auth.users where id not in (select user_id from public.employees where user_id is not null);
		insert into auth.users (id, email) values
		  ('00000000-0000-0000-0000-000000000098', 'shared-pc@example.jp'),
		  ('00000000-0000-0000-0000-000000000099', 'typa-e99@example.jp');
		truncate public.security_audit_log;`);
});
afterAll(async () => {
	await db?.close();
});

describe("an account that no employee owns", () => {
	// 何も渡さない・実在の ID を渡す、の両方で、ログイン済みなら呼べる関数をすべて呼ぶ。
	// 新しい関数も自動で対象になる。値を返してよいのは、ログイン前から要るもの・登録の入口・計算だけ。
	const MAY_ANSWER: Record<string, string> = {
		"get_required_domain()":
			"ログイン画面が、社員番号からログイン用アドレスを作るのに使う(anon も呼べる)",
		"get_current_employee_access_state()": "「未登録」と答えて、登録へ案内する",
		"begin_registration(text,text)":
			"登録の入口。招待コードが違えば invalid_invitation とだけ答える",
		"evaluation_rank(integer)": "点数を評語に変える計算。データを読まない",
	};
	const EMPTY = new Set(["null", "false", "[]", "{}"]);

	it.each([
		["the mailbox that received a code", 98, "otp"],
		["an account with a mistyped address", 96, "otp"],
		["a login account left before its link", 99, "password"],
	])(
		"reads nothing and changes nothing: %s",
		async (_, actor, method) => {
			await account(96, "taro.yamada@gmial.com");
			await db.exec(`reset role;
			set session_replication_role = replica;
			insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, grade_id, item_set_id)
			values (1, 1, 4, 'submitted', 2, 1, 1) on conflict do nothing;
			insert into public.milestones (sheet_id, goal_number, challenge_goal) values (1, 1, '目標') on conflict do nothing;
			set session_replication_role = origin;`);
			const tables = await rows<{ name: string }>(
				"select tablename as name from pg_tables where schemaname = 'public' order by 1",
			);
			const functions = await rows<{ signature: string; name: string; args: string[] }>(`
			select regexp_replace(p.oid::regprocedure::text, '^public\\.', '') as signature, p.proname as name,
			       array(select format_type(t, null) from unnest(p.proargtypes) t) as args
			from pg_proc p
			where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
			  and has_function_privilege('authenticated', p.oid, 'execute')
			order by 1`);
			expect(functions.length).toBeGreaterThan(40);
			const before = await rows(
				"select (select count(*) from public.evaluation_sheets) sheets, (select count(*) from public.milestones) goals, (select count(*) from public.employees where user_id is not null) linked, (select count(*) from public.security_audit_log) audits",
			);

			const answered: string[] = [];
			for (const table of tables) {
				await actAs(db, actor, method);
				const seen = await rows<{ n: number }>(
					`select count(*)::int as n from public.${table.name}`,
				).catch(() => [{ n: 0 }]);
				if (seen[0].n > 0) {
					answered.push(table.name);
				}
			}
			for (const fn of functions) {
				for (const id of [null, 1]) {
					await actAs(db, actor, method);
					const args = fn.args
						.map((type) => `${id !== null && /int/.test(type) ? id : "null"}::${type}`)
						.join(", ");
					await db.exec("begin");
					try {
						const result = await rows<{ v: unknown }>(
							`select to_jsonb(r) -> 'v' as v from (select public.${fn.name}(${args}) as v) r`,
						);
						const shown = result.map((row) => JSON.stringify(row.v ?? null));
						if (shown.some((text) => !EMPTY.has(text)) && !(fn.signature in MAY_ANSWER)) {
							answered.push(`${fn.signature} -> ${shown.join(",")}`);
						}
					} catch {
						// 断られた
					} finally {
						await db.exec("rollback");
					}
				}
			}
			expect(answered).toEqual([]);
			await db.exec("reset role");
			expect(
				await rows(
					"select (select count(*) from public.evaluation_sheets) sheets, (select count(*) from public.milestones) goals, (select count(*) from public.employees where user_id is not null) linked, (select count(*) from public.security_audit_log) audits",
				),
			).toEqual(before);
		},
		60_000,
	);
});

describe("finishing a registration", () => {
	it("removes the account that only received the code, and keeps the address for notices", async () => {
		const { token } = await begin("E7");
		expect(await complete(token)).toBe(true);
		expect(await accounts()).not.toContain("shared-pc@example.jp");
		expect(await accounts()).toContain("typa-e7@example.jp");
		await db.exec("reset role");
		expect(
			await rows(
				"select e.user_id, c.email from public.employees e join public.employee_contacts c on c.employee_id = e.id where e.id = 7",
			),
		).toEqual([{ user_id: uid(97), email: "shared-pc@example.jp" }]);
	});

	it("keeps a shared mailbox while another employee is still registering with it", async () => {
		const e8 = await begin("E8");
		expect(e8.status).toBe("available");
		const { token } = await begin("E7");
		expect(await complete(token)).toBe(true);
		expect(await accounts()).toContain("shared-pc@example.jp");
		// E8 は続きから登録できる
		await account(95, "typa-e8@example.jp");
		await actAs(db, 95);
		expect(await value<boolean>("public.complete_registration($1)", [e8.token])).toBe(true);
		expect(await accounts()).not.toContain("shared-pc@example.jp");
	});

	it("removes every account that no employee took for a day, and records only how many", async () => {
		await db.exec("reset role; update auth.users set created_at = now() - interval '1 year'");
		await account(96, "taro.yamada@gmial.com", "2 days");
		await account(95, "never-confirmed@example.com", "25 hours");
		await account(94, "typa-e9@example.jp", "3 days");
		await account(93, "typa-e8@example.jp", "23 hours");
		await account(92, "someone-registering@example.com", "1 hour");
		const { token } = await begin("E7");
		expect(await complete(token)).toBe(true);

		const left = await accounts();
		// 社員に紐付いたアカウントは、どれほど古くても(利用停止中でも)残す
		for (const linked of [1, 2, 3, 4, 5, 6]) {
			expect(left).toContain(`typa-e${linked}@example.jp`);
		}
		expect(left).toContain("typa-e7@example.jp");
		// 1日たっていないものは、登録の途中かもしれないので残す
		expect(left).toEqual(
			expect.arrayContaining(["typa-e8@example.jp", "someone-registering@example.com"]),
		);
		for (const stale of [
			"taro.yamada@gmial.com",
			"never-confirmed@example.com",
			"typa-e9@example.jp",
			"typa-e99@example.jp",
			"shared-pc@example.jp",
		]) {
			expect(left).not.toContain(stale);
		}
		// 打ち間違えたアドレスは記録に残さない(個人情報を、用のない場所に写さない)
		expect(await audits()).toEqual([
			{
				actor_user_id: null,
				action: "account.unlinked_removed",
				entity_id: null,
				details: { removed: 4 },
			},
		]);
	});

	it("removes nothing and records nothing when there is nothing to remove", async () => {
		const { token } = await begin("E7");
		await db.exec(`reset role; delete from auth.users where id = '${uid(99)}'`);
		expect(await complete(token)).toBe(true);
		expect(await audits()).toEqual([]);
	});

	it("undoes the whole registration when the record of the removal cannot be written", async () => {
		await account(96, "taro.yamada@gmial.com", "2 days");
		const { token } = await begin("E7");
		await db.exec(`reset role;
			create function public.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$;
			create trigger fail_audit before insert on public.security_audit_log
			for each row when (new.action = 'account.unlinked_removed') execute function public.fail_audit();`);
		try {
			await expect(complete(token)).rejects.toThrow("audit down");
		} finally {
			await db.exec(
				"reset role; drop trigger fail_audit on public.security_audit_log; drop function public.fail_audit()",
			);
		}
		expect(await accounts()).toEqual(
			expect.arrayContaining(["taro.yamada@gmial.com", "shared-pc@example.jp"]),
		);
		await db.exec("reset role");
		expect(await rows("select user_id from public.employees where id = 7")).toEqual([
			{ user_id: null },
		]);
	});

	it.each([
		["anonymous", 0],
		["an employee", 4],
		["an Admin", 1],
		["the mailbox that received a code", 98],
		["an account without an employee", 99],
	])("cannot be swept on demand by %s", async (_, actor) => {
		await account(96, "taro.yamada@gmial.com", "2 days");
		await actAs(db, actor, actor === 98 ? "otp" : "password");
		await expect(rows("select public.remove_unlinked_auth_accounts()")).rejects.toMatchObject(
			DENIED,
		);
		expect(await accounts()).toContain("taro.yamada@gmial.com");
	});
});

it("removes the stale accounts already left in Auth when the migration is applied", async () => {
	const old = await createProdLikeDb(MIGRATION.slice(0, 12));
	try {
		await old.exec(`
			insert into auth.users (id, email, created_at) values
			  ('00000000-0000-0000-0000-000000000096', 'taro.yamada@gmial.com', now() - interval '30 days'),
			  ('00000000-0000-0000-0000-000000000092', 'someone-registering@example.com', now());
			update auth.users set created_at = now() - interval '30 days' where id <> '00000000-0000-0000-0000-000000000092';`);
		await applyMigrations(old, (file) => file === MIGRATION);
		const left = (
			await old.query<{ email: string }>("select email from auth.users order by email")
		).rows.map((row) => row.email);
		expect(left).toEqual([
			"someone-registering@example.com",
			...[1, 2, 3, 4, 5, 6].map((n) => `typa-e${n}@example.jp`),
		]);
		expect(
			(await old.query("select actor_user_id, action, details from public.security_audit_log"))
				.rows,
		).toEqual([
			{ actor_user_id: null, action: "account.unlinked_removed", details: { removed: 3 } },
		]);
	} finally {
		await old.close();
	}
}, 60_000);
