import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const rows = async (sql: string) => (await db.query(sql)).rows;
const keep = (employeeId: number, value: boolean) =>
	rows(
		`update public.employees set keep_signed_in = ${value} where id = ${employeeId} returning id`,
	);

// 社員 1: Admin 2: Reviewer(4 の一次評価者) 4・5: Employee
beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("ends everyone's session with the app until an Admin says otherwise", async () => {
	await actAs(db, 1);
	expect(await rows("select distinct keep_signed_in from public.employees")).toEqual([
		{ keep_signed_in: false },
	]);
});

it("lets only an Admin decide who stays signed in", async () => {
	// Reviewer は社員マスタを閲覧できるが、更新はできない
	await actAs(db, 2);
	expect(await keep(4, true)).toEqual([]);
	// Employee は社員マスタを更新できない(自分の行も)
	await actAs(db, 4);
	expect(await keep(4, true)).toEqual([]);
	await actAs(db, 1);
	expect(await keep(4, true)).toEqual([{ id: 4 }]);
});

it("lets an employee read their own setting, which the app follows at sign-in", async () => {
	const own = async (id: number) => {
		await actAs(db, id);
		return rows("select keep_signed_in from public.employees where user_id = auth.uid()");
	};
	expect(await own(4)).toEqual([{ keep_signed_in: true }]);
	expect(await own(5)).toEqual([{ keep_signed_in: false }]);
	// ログイン前・社員に紐付かないアカウントには、何も返らない
	await actAs(db, 99);
	expect(await rows("select keep_signed_in from public.employees")).toEqual([]);
	await actAs(db, 0);
	await expect(rows("select keep_signed_in from public.employees")).rejects.toMatchObject({
		code: "42501",
	});
});
