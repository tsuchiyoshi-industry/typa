import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyMigrations, createProdLikeDb } from "./prodLikeDb";

// 本番では、ベースラインの check_user_limit が restrict_signup として auth.users に手で付けられていた。
// 社員1人が2アカウント(連絡先とログイン用)使うので、約75人で新規登録が止まった(202611120001)。
const MIGRATION = "202611120001_";
let db: PGlite;
let blockedBefore: unknown;
const query = async <T = Record<string, unknown>>(target: PGlite, sql: string) =>
	(await target.query<T>(sql)).rows;
const signUp = (n: number) =>
	db.query(
		`insert into auth.users(id,email) values('00000000-0000-0000-0000-${String(n).padStart(12, "0")}','typa-n${n}@example.jp')`,
	);
const limitFunction = async (target: PGlite) =>
	(
		await query<{ f: string | null }>(
			target,
			"select to_regprocedure('public.check_user_limit()')::text f",
		)
	)[0]?.f;
const authTriggers = async () =>
	(
		await query<{ tgname: string }>(
			db,
			"select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal order by 1",
		)
	).map((row) => row.tgname);

beforeAll(async () => {
	db = await createProdLikeDb(MIGRATION);
	// 本番の状態を再現する。上限は種データの件数(8)にして、次の1件で止まるようにする。
	// 同じ関数を別名で付けたトリガーと、関係のないトリガーも置く
	await db.exec(`reset role;
		create function public.check_user_limit() returns trigger language plpgsql security definer as $$
		begin
		  if (select count(*) from auth.users) >= 8 then raise exception 'User registration limit reached.'; end if;
		  return new;
		end; $$;
		create trigger restrict_signup before insert on auth.users for each row execute function public.check_user_limit();
		create trigger restrict_signup_again before insert on auth.users for each row execute function public.check_user_limit();
		create function public.unrelated_auth_trigger() returns trigger language plpgsql as $$ begin return new; end; $$;
		create trigger unrelated before insert on auth.users for each row execute function public.unrelated_auth_trigger();`);
	blockedBefore = await signUp(200).catch((error: unknown) => error);
	await applyMigrations(db, (file) => file.startsWith(MIGRATION));
	// 2度当てても失敗しない
	await applyMigrations(db, (file) => file.startsWith(MIGRATION));
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("blocked sign-up at the limit before the migration (the production failure)", () => {
	expect(String(blockedBefore)).toContain("User registration limit reached.");
});

it("lets accounts be created past the old limit", async () => {
	await signUp(300);
	await signUp(301);
	expect(
		(
			await query<{ n: number }>(
				db,
				"select count(*)::int n from auth.users where id::text like '%00000030_'",
			)
		)[0]?.n,
	).toBe(2);
});

it("removes the limit function and every trigger that used it, under any name", async () => {
	expect(await limitFunction(db)).toBeNull();
	expect(await authTriggers()).toEqual(["unrelated"]);
});

it("applies on a database that never had the limit", async () => {
	const fresh = await createProdLikeDb();
	try {
		expect(await limitFunction(fresh)).toBeNull();
	} finally {
		await fresh.close();
	}
});
