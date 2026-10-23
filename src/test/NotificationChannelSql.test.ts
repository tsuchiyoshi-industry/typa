import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

const migration = readFileSync(
	new URL("../../supabase/migrations/202610230002_notification_channel.sql", import.meta.url),
	"utf8",
);

// 社員 1: Admin 2・3: 評価者(Reviewer) 4: 評価される本人
let db: PGlite;
const channel = async () =>
	(
		await db.query<{ notification_channel: string }>(
			"select notification_channel from public.workspace_settings",
		)
	).rows;

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
// 失敗したテストが設定を変えたまま、次のテストを巻き込まないようにする
beforeEach(async () => {
	await db.exec(`reset role; update public.workspace_settings
		set notification_channel = 'in_app', smtp_verified_at = null,
		    smtp_host = '', smtp_port = 465, smtp_user = '', smtp_password = ''`);
});
afterAll(async () => {
	await db?.close();
});

const choose = (value: string | null) =>
	db.query("update public.workspace_settings set notification_channel = $1 where id returning id", [
		value,
	]);

it("notifies in the app by default", async () => {
	await actAs(db, 1);
	expect(await channel()).toEqual([{ notification_channel: "in_app" }]);
});

it("does not allow mail until the SMTP settings pass a test send", async () => {
	// 送信テストの仕組みができる前に保存された設定(本番の既存の設定)も、確かめていない設定として扱う
	await db.exec(`reset role; update public.workspace_settings
		set smtp_host = 'smtp.example.jp', smtp_port = 465, smtp_user = 'sender@example.jp', smtp_password = 'synthetic'`);
	await actAs(db, 1);
	await expect(choose("email")).rejects.toMatchObject({ code: "23514" });
	expect(await channel()).toEqual([{ notification_channel: "in_app" }]);
});

it("lets an Admin choose mail once the SMTP settings passed a test send, and go back", async () => {
	await db.exec("reset role; update public.workspace_settings set smtp_verified_at = now()");
	await actAs(db, 1);
	expect((await choose("email")).rows).toHaveLength(1);
	expect(await channel()).toEqual([{ notification_channel: "email" }]);
	expect((await choose("in_app")).rows).toHaveLength(1);
	expect(await channel()).toEqual([{ notification_channel: "in_app" }]);
});

it("keeps the chosen channel when the migration is applied again", async () => {
	await db.exec(`reset role; update public.workspace_settings
		set smtp_verified_at = now(), notification_channel = 'email'`);
	await db.exec(migration);
	await actAs(db, 1);
	expect(await channel()).toEqual([{ notification_channel: "email" }]);
});

it.each([2, 4])("ignores a change of channel by non-Admin %s", async (id) => {
	await db.exec("reset role; update public.workspace_settings set smtp_verified_at = now()");
	await actAs(db, id);
	expect((await choose("email")).rows).toEqual([]);
	await actAs(db, 1);
	expect(await channel()).toEqual([{ notification_channel: "in_app" }]);
});

it.each([["both"], ["IN_APP"], [""], [null]])("rejects %j as the channel", async (value) => {
	await actAs(db, 1);
	await expect(choose(value)).rejects.toMatchObject({
		code: value === null ? "23502" : "23514",
	});
	expect(await channel()).toEqual([{ notification_channel: "in_app" }]);
});
