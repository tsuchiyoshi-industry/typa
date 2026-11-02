import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb, sessionId, uid } from "../prodLikeDb";

// ASVS v5.0.0: V7.4.1(ログアウト後のセッション無効化)、V7.4.2(アカウント停止時の失効)、V8.2.1。
// Web では、ログアウトした後もブラウザやプロキシにアクセストークン(最長 jwt_expiry)が残り得る。
// DB は、トークンの session_id が Auth に生きているときだけ社員として扱う。
let db: PGlite;
const denied = { code: "42501" };
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await rows<{ v: T }>(`select ${sql} as v`, params))[0].v;
/** オーナーで sql を流してから、直前と同じトークン(JWT の設定はそのまま)の利用者に戻る。 */
const asOwnerThenBack = (sql: string) => db.exec(`reset role; ${sql}; set role authenticated;`);
const useClaims = (claims: Record<string, unknown>) =>
	db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
/** オーナーで見た保存内容。利用者のロールのままでは RLS で隠れて比べられない。最後に利用者のロールへ戻す。 */
const snapshot = async () => {
	await db.exec("reset role");
	const saved =
		await rows(`select (select status from public.evaluation_sheets where id = 100) as status,
		(select challenge_goal from public.milestones where id = 100) as goal,
		(select max_challenge_goals from public.evaluation_settings) as max_goals,
		(select role_id from public.employees where id = 5) as role`);
	await db.exec("set role authenticated");
	return saved;
};

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});
beforeEach(async () => {
	await db.exec(`reset role;
		truncate auth.sessions;
		truncate public.evaluation_sheets cascade;
		insert into public.evaluation_sheets(id,period_id,employee_id) values(100,1,4);
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal) values(100,100,1,'own-goal');`);
});

/** 本人(4)が一通りの読み書きをできるか。 */
async function subjectCanWork() {
	expect(await value("public.current_employee_id()")).toBe(4);
	expect(await value("public.get_sheet(100)")).toMatchObject({
		objectives: [expect.objectContaining({ challengeGoal: "own-goal" })],
	});
	expect(
		await rows("update public.milestones set challenge_goal='own-goal' where id=100 returning id"),
	).toEqual([{ id: 100 }]);
}

it("lets a signed-in employee work while the session is alive (positive control)", async () => {
	await actAs(db, 4);
	await subjectCanWork();
});

describe.each([
	["logged out", `delete from auth.sessions where id='${sessionId(4)}'`],
	["past its time box", `update auth.sessions set not_after=now()-interval '1 second'`],
	["bound to another account", `update auth.sessions set user_id='${uid(1)}'`],
])("a session %s", (_, revoke) => {
	it("cannot read or change anything with the token it already holds", async () => {
		await actAs(db, 4);
		await subjectCanWork();
		const before = await snapshot();
		await asOwnerThenBack(revoke);

		expect(await value("public.current_employee_id()")).toBeNull();
		expect(await value("public.get_sheet(100)")).toBeNull();
		expect(await rows("select id from public.employees")).toEqual([]);
		expect(await rows("select id from public.milestones")).toEqual([]);
		expect(
			await rows(
				"update public.milestones set challenge_goal='after logout' where id=100 returning id",
			),
		).toEqual([]);
		await expect(
			rows("insert into public.milestones(sheet_id,goal_number,challenge_goal) values(100,2,'x')"),
		).rejects.toMatchObject(denied);
		await expect(
			rows("select public.transition_evaluation_sheet(100,'goals_submitted')"),
		).rejects.toMatchObject(denied);
		await db.exec("reset role");
		expect(await snapshot()).toEqual(before);
	});
});

it("takes an Admin's privileges away with the session, including the settings policies", async () => {
	await actAs(db, 1);
	expect(await rows("select smtp_host from public.workspace_settings")).toHaveLength(1);
	const before = await snapshot();
	await asOwnerThenBack(`delete from auth.sessions where id='${sessionId(1)}'`);

	await expect(rows("select public.set_employee_role('E5','Admin')")).rejects.toMatchObject(denied);
	expect(await rows("select smtp_host from public.workspace_settings")).toEqual([]);
	expect(
		await rows("update public.evaluation_settings set max_challenge_goals=9 returning id"),
	).toEqual([]);
	expect(await rows("select id from public.security_audit_log")).toEqual([]);
	await db.exec("reset role");
	expect(await snapshot()).toEqual(before);
});

it("keeps the person's other live sessions working when one of them logs out", async () => {
	await actAs(db, 4);
	const other = "5e550000-0000-0000-0000-0000000000aa";
	await asOwnerThenBack(
		`insert into auth.sessions(id,user_id) values('${other}','${uid(4)}');
		delete from auth.sessions where id='${sessionId(4)}'`,
	);
	expect(await value("public.current_employee_id()")).toBeNull();
	await useClaims({ session_id: other });
	await subjectCanWork();
});

it("rejects a session_id that is not a UUID instead of treating it as missing", async () => {
	await actAs(db, 4);
	await useClaims({ session_id: "not-a-uuid" });
	await expect(rows("select public.current_employee_id()")).rejects.toThrow();
});

// Auth が発行するアクセストークンには必ず session_id がある。ないものを作れるのは署名鍵を持つ者だけで、
// その者は service_role のトークンも作れる。ここは従来どおり、署名の検証(PostgREST)に任せる
it("falls back to the signature check for tokens that carry no session_id", async () => {
	await actAs(db, 4);
	await useClaims({});
	await subjectCanWork();
});

describe("Admin-only settings use the shared Admin check", () => {
	it.each([
		[2, "Reviewer"],
		[4, "Employee"],
	])(
		"employee %s (%s) can neither read SMTP settings nor change evaluation settings",
		async (id) => {
			await actAs(db, id);
			expect(await rows("select smtp_host from public.workspace_settings")).toEqual([]);
			expect(
				await rows("update public.evaluation_settings set max_challenge_goals=9 returning id"),
			).toEqual([]);
			expect(
				await rows(
					"update public.workspace_settings set notification_channel='email' returning id",
				),
			).toEqual([]);
		},
	);

	it("refuses a suspended Admin who still holds a live session", async () => {
		await actAs(db, 1);
		await asOwnerThenBack(`alter table public.employees disable trigger user;
			update public.employees set is_enabled=false where id=1;
			alter table public.employees enable trigger user`);
		try {
			expect(await rows("select smtp_host from public.workspace_settings")).toEqual([]);
			expect(
				await rows("update public.evaluation_settings set max_challenge_goals=9 returning id"),
			).toEqual([]);
		} finally {
			await db.exec(`reset role; alter table public.employees disable trigger user;
				update public.employees set is_enabled=true where id=1;
				alter table public.employees enable trigger user`);
		}
	});

	it("lets an enabled Admin change them (positive control)", async () => {
		await actAs(db, 1);
		const [{ max_challenge_goals: current }] = await rows<{ max_challenge_goals: number }>(
			"select max_challenge_goals from public.evaluation_settings",
		);
		expect(
			await rows("update public.evaluation_settings set max_challenge_goals=$1 returning id", [
				current,
			]),
		).toHaveLength(1);
	});
});
