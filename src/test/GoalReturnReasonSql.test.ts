import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

let db: PGlite;
const value = async <T>(sql: string, args: unknown[] = []) =>
	(await db.query<{ v: T }>(`select ${sql} as v`, args)).rows[0].v;
const transition = (status: string, reason?: string | null) =>
	value("public.transition_evaluation_sheet(900,$1,$2)", [status, reason ?? null]);
const stored = async () => {
	await db.exec("reset role");
	return value<string | null>(
		"(select goal_return_reason from public.evaluation_sheets where id=900)",
	);
};

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
beforeEach(async () => {
	await db.exec(`reset role; delete from public.evaluation_sheets where id=900;
		insert into public.evaluation_sheets(id,period_id,employee_id) values(900,1,4);
		insert into public.milestones(sheet_id,goal_number,challenge_goal) values(900,1,'目標');`);
	await actAs(db, 4);
	await transition("goals_submitted");
	await actAs(db, 2);
});
afterAll(async () => {
	await db?.close();
});

it("stores the trimmed reason with the return and shows it to the subject and in the mail", async () => {
	expect(await transition("draft", "　 数値目標を入れてください\n")).toBeNull();
	expect(await stored()).toBe("数値目標を入れてください");

	await actAs(db, 4);
	expect(await value("public.get_sheet(900)->>'goalReturnReason'")).toBe(
		"数値目標を入れてください",
	);
	await db.exec("reset role; set role service_role");
	expect(await value("public.get_sheet_notification(900,$1)->>'returnReason'", [uid(2)])).toBe(
		"数値目標を入れてください",
	);
});

it.each([
	["missing", null],
	["blank", " \n　"],
	["too long", "あ".repeat(201)],
])("refuses a return whose reason is %s and keeps the goals submitted", async (_case, reason) => {
	await expect(transition("draft", reason)).rejects.toMatchObject({ code: "22023" });
	expect(await value("(select status from public.evaluation_sheets where id=900)")).toBe(
		"goals_submitted",
	);
});

it("accepts exactly 200 characters", async () => {
	await transition("draft", "あ".repeat(200));
	expect(await stored()).toHaveLength(200);
});

it("checks permission before the reason, so the subject cannot probe it", async () => {
	await actAs(db, 4);
	await expect(transition("draft", "理由")).rejects.toMatchObject({ code: "42501" });
});

it("cannot be bypassed by writing the status or the reason directly", async () => {
	await expect(
		db.query("update public.evaluation_sheets set status='draft' where id=900"),
	).rejects.toMatchObject({ code: "22023" });
	await expect(
		db.query("update public.evaluation_sheets set goal_return_reason='x' where id=900"),
	).rejects.toMatchObject({ code: "42501" });
});

it("clears the reason once the goals are sent again, and ignores a reason on other transitions", async () => {
	await transition("draft", "理由");
	await actAs(db, 4);
	await transition("goals_submitted", "本人は理由を書けない");
	expect(await stored()).toBeNull();
	await actAs(db, 4);
	expect(await value("public.get_sheet(900)->'goalReturnReason'")).toBe(null);
});
