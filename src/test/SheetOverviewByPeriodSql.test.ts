import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, onTestFinished } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 全社のシート一覧は、評価期間ごとに読む(全期間を丸ごと送らない)。期間の切り替えと件数・
// 監査ログの名寄せは、ID と期間・社員だけの軽い一覧(get_sheet_index)で行う。

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await query<{ v: T }>(sql, params))[0]?.v as T;
type Row = { id: number; periodId: number };
const ids = (rows: Row[]) => rows.map((row) => row.id).sort();

// 期間 1(実施中): 社員 4・6 のシート。期間 2(締め済み): 社員 4 の確定したシート
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`reset role;
		alter table public.evaluation_sheets disable trigger user;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, first_overall_comment) values
		  (11, 1, 4, 'draft', 2, ''), (12, 1, 6, 'submitted', 2, ''), (21, 2, 4, 'finalized', 2, '前期の総評');
		alter table public.evaluation_sheets enable trigger user;`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("gives Admin the sheets of one evaluation period", async () => {
	await actAs(db, 1);
	expect(ids(await value<Row[]>("select public.get_sheet_overview(1) as v"))).toEqual([11, 12]);
	const [past] = await value<(Row & { firstOverallComment: string })[]>(
		"select public.get_sheet_overview(p_period_id => 2) as v",
	);
	expect(past).toMatchObject({ id: 21, periodId: 2, firstOverallComment: "前期の総評" });
	expect(await value("select public.get_sheet_overview(999) as v")).toEqual([]);
});

it("still gives every period when no period is named (the app before this change)", async () => {
	await actAs(db, 1);
	expect(ids(await value<Row[]>("select public.get_sheet_overview() as v"))).toEqual([11, 12, 21]);
});

it("gives Admin a light index of every sheet and period, without names or comments", async () => {
	await actAs(db, 1);
	const index = await value<{
		periods: { id: number; name: string; startDate: string }[];
		sheets: Record<string, number>[];
	}>("select public.get_sheet_index() as v");
	expect(index.sheets.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))).toEqual([
		{ id: 11, periodId: 1, employeeId: 4 },
		{ id: 12, periodId: 1, employeeId: 6 },
		{ id: 21, periodId: 2, employeeId: 4 },
	]);
	expect(index.periods).toEqual(
		expect.arrayContaining([
			{ id: 1, name: "実施中", startDate: "2026-04-01" },
			{ id: 2, name: "締め済み", startDate: "2025-10-01" },
		]),
	);
});

it.each([
	["a Reviewer", 2],
	["an Employee", 4],
	["an account without an employee", 99],
])("refuses %s", async (_, employee) => {
	await actAs(db, employee);
	await expect(query("select public.get_sheet_overview(1)")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(query("select public.get_sheet_index()")).rejects.toMatchObject({
		code: "42501",
	});
});

it("refuses a suspended Admin", async () => {
	// 断られる文を流すので、トランザクションでは巻き戻せない。終わったら戻す
	await db.exec("reset role; update public.employees set is_enabled = false where id = 1");
	onTestFinished(async () => {
		await db.exec("reset role; update public.employees set is_enabled = true where id = 1");
	});
	await actAs(db, 1);
	await expect(query("select public.get_sheet_index()")).rejects.toMatchObject({ code: "42501" });
	await expect(query("select public.get_sheet_overview(1)")).rejects.toMatchObject({
		code: "42501",
	});
});

it("cannot be called before sign-in", async () => {
	await actAs(db, 0);
	await expect(query("select public.get_sheet_index()")).rejects.toThrow(/permission denied/);
	await expect(query("select public.get_sheet_overview(1)")).rejects.toThrow(/permission denied/);
});
