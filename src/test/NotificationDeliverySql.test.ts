import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

let db: PGlite;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await db.query<{ v: T }>(`select ${sql} as v`, params)).rows[0].v;
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(
		"insert into public.evaluation_sheets(id,period_id,employee_id) values(900,1,4); insert into public.milestones(sheet_id,goal_number,challenge_goal) values(900,1,'Goal');",
	);
	await actAs(db, 4);
	await value("public.transition_evaluation_sheet(900,'goals_submitted')");
}, 60_000);
afterAll(async () => {
	await db?.close();
});
it("only permits server-side claims for the actor of the current stage", async () => {
	await actAs(db, 4);
	await expect(value("public.claim_sheet_notification(900,$1)", [uid(4)])).rejects.toMatchObject({
		code: "42501",
	});
	await db.exec("reset role; set role service_role");
	await expect(value("public.claim_sheet_notification(900,$1)", [uid(5)])).rejects.toMatchObject({
		code: "42501",
	});
});
it("deduplicates requests, cools down failures, rotates claim tokens and never retries success", async () => {
	await db.exec("reset role; set role service_role");
	const claim = () =>
		value<{ claimId?: string; skipped?: string }>("public.claim_sheet_notification(900,$1)", [
			uid(4),
		]);
	const first = await claim();
	expect(first.claimId).toBeTypeOf("string");
	expect((await claim()).skipped).toBe("cooldown");
	expect(await value("public.complete_sheet_notification($1,false)", [first.claimId])).toBe(true);
	expect((await claim()).skipped).toBe("cooldown");
	await db.exec(
		"reset role; update public.sheet_notification_deliveries set attempted_at=now()-interval '2 minutes'; set role service_role",
	);
	const retry = await claim();
	expect(retry.claimId).not.toBe(first.claimId);
	expect(await value("public.complete_sheet_notification($1,true)", [first.claimId])).toBe(false);
	expect(await value("public.complete_sheet_notification($1,true)", [retry.claimId])).toBe(true);
	expect((await claim()).skipped).toBe("sent");
});
it("treats a later resubmission as a new event", async () => {
	await actAs(db, 4);
	await actAs(db, 2);
	await value("public.transition_evaluation_sheet(900,'draft')");
	await actAs(db, 4);
	await value("public.transition_evaluation_sheet(900,'goals_submitted')");
	await db.exec("reset role; set role service_role");
	expect(await value("public.claim_sheet_notification(900,$1)->>'claimId'", [uid(4)])).toBeTypeOf(
		"string",
	);
});
it("limits delivery attempts across repeated resubmissions of the same sheet", async () => {
	await db.exec(
		"reset role; update public.sheet_notification_deliveries set attempts=5, attempted_at=now()",
	);
	await actAs(db, 4);
	await actAs(db, 2);
	await value("public.transition_evaluation_sheet(900,'draft')");
	await actAs(db, 4);
	await value("public.transition_evaluation_sheet(900,'goals_submitted')");
	await db.exec("reset role; set role service_role");
	expect(await value("public.claim_sheet_notification(900,$1)->>'skipped'", [uid(4)])).toBe(
		"rate_limit",
	);
	await db.exec(
		"reset role; update public.sheet_notification_deliveries set attempted_at=now()-interval '11 minutes'; set role service_role",
	);
	expect(await value("public.claim_sheet_notification(900,$1)->>'claimId'", [uid(4)])).toBeTypeOf(
		"string",
	);
});
