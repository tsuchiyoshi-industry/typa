import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 社員 2: 一次評価者 3: 二次評価者 4: 評価される本人(一次 2・二次 3) 5: 無関係の社員
// 6: 二次評価者「なし」の本人(一次 2)。評価期間 1 は実施中。
let db: PGlite;
const notices = async () => {
	await db.exec("reset role");
	return (
		await db.query<Record<string, unknown>>(
			`select recipient_employee_id as recipient, sheet_id as sheet, kind,
			   employee_name, period_name, read_at is null as unread
			 from public.notifications order by id`,
		)
	).rows;
};
const move = async (actor: number, sheet: number, status: string) => {
	await actAs(db, actor);
	if (status === "first_evaluated" || status === "finalized") {
		// 確定の前に、その段階の評価をすべて入れる
		const stage = status === "first_evaluated" || actor === 2 ? "first" : "second";
		await db.query(`update public.milestones set ${stage}_score = 4 where sheet_id = $1`, [sheet]);
		const key = stage === "first" ? "firstScore" : "secondScore";
		await db.query("select public.save_common_evaluation($1, $2::jsonb)", [
			sheet,
			JSON.stringify([
				{ itemId: 1, [key]: 4 },
				{ itemId: 2, [key]: 4 },
			]),
		]);
	}
	await db.query("select public.transition_evaluation_sheet($1, $2)", [sheet, status]);
};

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
// シートを作り直し、通知を空にする(評価者はシートを作ったときの社員マスタから決まる)
beforeEach(async () => {
	await db.exec(`reset role;
		delete from public.evaluation_sheets;
		update public.employees
		set primary_evaluator_id = 2, secondary_evaluator_id = 3, no_secondary_evaluator = false
		where id = 4;
		update public.workspace_settings set notification_channel = 'in_app';
		insert into public.evaluation_sheets (id, period_id, employee_id) values (100, 1, 4), (200, 1, 6);
		insert into public.milestones (sheet_id, goal_number, challenge_goal)
		values (100, 1, '目標'), (200, 1, '目標');`);
});
afterAll(async () => {
	await db?.close();
});

it("tells the primary evaluator when a sheet is submitted", async () => {
	await move(4, 100, "submitted");
	expect(await notices()).toEqual([
		{
			recipient: 2,
			sheet: 100,
			kind: "submitted",
			employee_name: "社員4",
			period_name: "実施中",
			unread: true,
		},
	]);
});

it("asks the secondary evaluator next, and marks the finished request as read", async () => {
	await move(4, 100, "submitted");
	await move(2, 100, "first_evaluated");
	expect(await notices()).toEqual([
		expect.objectContaining({ recipient: 2, kind: "submitted", unread: false }),
		expect.objectContaining({ recipient: 3, sheet: 100, kind: "first_evaluated", unread: true }),
	]);
});

it("asks nobody after the final confirmation, and closes the last request", async () => {
	await move(4, 100, "submitted");
	await move(2, 100, "first_evaluated");
	await move(3, 100, "finalized");
	// 二次評価者「なし」: 一次評価者がそのまま最終確定する
	await move(6, 200, "submitted");
	await move(2, 200, "finalized");
	expect(await notices()).toEqual([
		expect.objectContaining({ recipient: 2, sheet: 100, kind: "submitted", unread: false }),
		expect.objectContaining({ recipient: 3, sheet: 100, kind: "first_evaluated", unread: false }),
		expect.objectContaining({ recipient: 2, sheet: 200, kind: "submitted", unread: false }),
	]);
});

it("withdraws the request when the employee takes the sheet back, and asks again on resubmission", async () => {
	await move(4, 100, "submitted");
	await move(4, 100, "draft");
	expect(await notices()).toEqual([]);
	await move(4, 100, "submitted");
	expect(await notices()).toEqual([
		expect.objectContaining({ recipient: 2, sheet: 100, kind: "submitted", unread: true }),
	]);
});

it("leaves it to mail when the workspace notifies by mail", async () => {
	await db.exec(`reset role; update public.workspace_settings
		set smtp_verified_at = now(), notification_channel = 'email'`);
	await move(4, 100, "submitted");
	await move(2, 100, "first_evaluated");
	expect(await notices()).toEqual([]);
});

const visibleTo = async (id: number) => {
	await actAs(db, id);
	return (
		await db.query<{ recipient: number }>(
			"select recipient_employee_id as recipient from public.notifications order by id",
		)
	).rows.map((row) => row.recipient);
};

it("shows each notice only to its recipient", async () => {
	await move(4, 100, "submitted");
	await move(2, 100, "first_evaluated");
	expect(await visibleTo(2)).toEqual([2]);
	expect(await visibleTo(3)).toEqual([3]);
	for (const id of [1, 4, 5]) {
		expect(await visibleTo(id)).toEqual([]);
	}
	await actAs(db, 0);
	await expect(db.query("select id from public.notifications")).rejects.toMatchObject({
		code: "42501",
	});
});

it("lets only the recipient mark a notice read or unread, and nothing else", async () => {
	await move(4, 100, "submitted");
	const markRead = (read: string) =>
		db.query(`update public.notifications set read_at = ${read} returning id`);
	await actAs(db, 3);
	expect((await markRead("now()")).rows).toEqual([]);
	await actAs(db, 2);
	expect((await markRead("now()")).rows).toHaveLength(1);
	expect(await notices()).toEqual([expect.objectContaining({ recipient: 2, unread: false })]);
	await actAs(db, 2);
	expect((await markRead("null")).rows).toHaveLength(1);
	expect(await notices()).toEqual([expect.objectContaining({ recipient: 2, unread: true })]);
	for (const change of [
		"recipient_employee_id = 5",
		"kind = 'first_evaluated'",
		"employee_name = '別人'",
		"sheet_id = 200",
	]) {
		await actAs(db, 2);
		await expect(db.query(`update public.notifications set ${change}`)).rejects.toMatchObject({
			code: "42501",
		});
	}
	await actAs(db, 2);
	await expect(db.query("delete from public.notifications")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(
		db.query(
			"insert into public.notifications (recipient_employee_id, sheet_id, kind, employee_name, period_name) values (2, 100, 'submitted', 'x', 'y')",
		),
	).rejects.toMatchObject({ code: "42501" });
});

it("creates nothing when the change of status is refused", async () => {
	await expect(move(5, 100, "submitted")).rejects.toMatchObject({ code: "42501" });
	await expect(move(2, 100, "first_evaluated")).rejects.toThrow();
	expect(await notices()).toEqual([]);
});

it("keeps the notices and goes on working when the migration is applied again", async () => {
	await move(4, 100, "submitted");
	await db.exec("reset role");
	await db.exec(
		readFileSync(
			new URL("../../supabase/migrations/202610230003_in_app_notifications.sql", import.meta.url),
			"utf8",
		),
	);
	await move(2, 100, "first_evaluated");
	expect(await notices()).toEqual([
		expect.objectContaining({ recipient: 2, unread: false }),
		expect.objectContaining({ recipient: 3, unread: true }),
	]);
	expect(await visibleTo(3)).toEqual([3]);
});

const transfer = (employee: number, change: string) =>
	db.exec(`reset role; update public.employees set ${change} where id = ${employee}`);

it("hands a waiting request over to the new primary evaluator after a transfer", async () => {
	await move(4, 100, "submitted");
	await transfer(4, "primary_evaluator_id = 5");
	expect(await notices()).toEqual([
		expect.objectContaining({ recipient: 5, sheet: 100, kind: "submitted", unread: true }),
	]);
	expect(await visibleTo(2)).toEqual([]);
	expect(await visibleTo(5)).toEqual([5]);
});

it("follows the secondary evaluator, and never blocks the Admin's change", async () => {
	await move(4, 100, "submitted");
	await move(2, 100, "first_evaluated");
	const waiting = async () =>
		(await notices()).filter((notice) => notice.kind === "first_evaluated" && notice.unread);
	await transfer(4, "secondary_evaluator_id = 5");
	expect(await waiting()).toEqual([expect.objectContaining({ recipient: 5 })]);
	// 二次評価者「なし」にすると、一次評価者がそのまま最終確定する
	await transfer(4, "secondary_evaluator_id = null, no_secondary_evaluator = true");
	expect(await waiting()).toEqual([expect.objectContaining({ recipient: 2 })]);
	// 誰も決まっていなければ、頼める人がいないので取り下げる
	await transfer(4, "no_secondary_evaluator = false");
	expect(await waiting()).toEqual([]);
	await transfer(4, "secondary_evaluator_id = 3");
	expect(await waiting()).toEqual([expect.objectContaining({ recipient: 3 })]);
});
