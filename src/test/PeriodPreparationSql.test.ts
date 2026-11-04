import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

// 業務のきまり: 評価期間は「締める」と「開始する」を分けて行う。締めると、次に開始する評価期間は準備中になり
// (自動では始まらない)、管理者が等級の変更などを済ませてから、準備中の評価期間を開始する。
// 期間 1 が実施中、2 が締め済み。3(下期)と 4(来期)はまだ始めていない。準備中は 3(最も早く始まる)。

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const close = async (periodId: number) =>
	(await rows<{ v: boolean }>("select public.close_evaluation_period($1) as v", [periodId]))[0].v;
const start = async (periodId: number) =>
	(await rows<{ v: boolean }>("select public.activate_evaluation_period($1) as v", [periodId]))[0]
		.v;
/** 期間の状態(DB の所有者として読む)。 */
const states = async () => {
	await db.exec("reset role");
	return (
		await rows<{ id: number; is_active: boolean; closed: boolean }>(
			"select id, is_active, closed_at is not null as closed from public.evaluation_periods order by id",
		)
	).map((row) => `${row.id}:${row.is_active ? "実施中" : row.closed ? "締め済み" : "未開始"}`);
};
const audits = async () => {
	await db.exec("reset role");
	return rows<{
		action: string;
		entity_id: number;
		actor_user_id: string;
		details: Record<string, unknown>;
	}>(
		"select action, entity_id, actor_user_id, details from public.security_audit_log where action like 'period.%' order by id",
	);
};
const BEFORE = ["1:実施中", "2:締め済み", "3:未開始", "4:未開始"];

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
beforeEach(async () => {
	// 準備ではトリガーを止め、毎回同じ状態から始める
	await db.exec(`
		reset role;
		set session_replication_role = replica;
		delete from public.evaluation_sheets;
		delete from public.evaluation_periods where id > 2;
		update public.evaluation_periods set is_active = (id = 1), closed_at = case when id = 2 then now() end,
			allow_unfinalized_close = false;
		insert into public.evaluation_periods (id, period_name, term_name, start_date, end_date)
		values (3, '下期', '下期', '2026-10-01', '2027-03-31'), (4, '来期', '来期', '2027-04-01', '2027-09-30');
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, secondary_evaluator_id)
		values (200, 1, 4, 'finalized', 2, 3);
		update public.employees set is_enabled = true;
		truncate public.security_audit_log;
		set session_replication_role = origin;
	`);
});
afterAll(async () => {
	await db?.close();
});

describe("closing and starting are separate steps", () => {
	it("closes the active period without starting the next one, and records it", async () => {
		expect(await states()).toEqual(BEFORE);
		await actAs(db, 1);
		expect(await close(1)).toBe(true);
		// 実施中の評価期間は無くなり、次は自動では始まらない
		expect(await states()).toEqual(["1:締め済み", "2:締め済み", "3:未開始", "4:未開始"]);
		expect(await audits()).toEqual([
			{
				action: "period.closed",
				entity_id: 1,
				actor_user_id: uid(1),
				details: {
					periodName: "実施中",
					finalizedSheets: 1,
					unfinishedSheets: 0,
					allowUnfinalizedClose: false,
					preparingPeriodId: 3,
				},
			},
		]);
	});

	it("starts only the preparing period, and only after closing, and records it", async () => {
		await actAs(db, 1);
		// 実施中の評価期間が残っているうちは、次を開始しない
		await expect(start(3)).rejects.toMatchObject({
			code: "23514",
			message: "「実施中」を締めてから、次の評価期間を開始してください。",
		});
		expect(await states()).toEqual(BEFORE);

		await actAs(db, 1);
		await close(1);
		// 準備中(最も早く始まる 3)を飛ばして、先の評価期間は開始しない
		await actAs(db, 1);
		await expect(start(4)).rejects.toMatchObject({
			code: "23514",
			message: "次に開始できるのは、準備中の評価期間だけです。",
		});
		// 締めた評価期間は、もう一度開始しない
		await expect(start(1)).rejects.toMatchObject({
			code: "23514",
			message: "締めた評価期間は、もう一度開始できません。",
		});
		expect(await start(999)).toBe(false);
		expect(await states()).toEqual(["1:締め済み", "2:締め済み", "3:未開始", "4:未開始"]);

		await actAs(db, 1);
		expect(await start(3)).toBe(true);
		expect(await states()).toEqual(["1:締め済み", "2:締め済み", "3:実施中", "4:未開始"]);
		// 実施中の評価期間を指定し直すだけなら、何も変えない
		await actAs(db, 1);
		expect(await start(3)).toBe(true);
		expect((await audits()).map(({ action, entity_id }) => `${action}:${entity_id}`)).toEqual([
			"period.closed:1",
			"period.started:3",
		]);
		expect((await audits())[1].details).toEqual({ periodName: "下期" });
	});

	it("refuses to close while sheets are unfinished, unless the period allows it", async () => {
		await db.exec(`reset role; set session_replication_role = replica;
			update public.evaluation_sheets set status = 'first_evaluated';
			set session_replication_role = origin;`);
		await actAs(db, 1);
		await expect(close(1)).rejects.toMatchObject({
			code: "23514",
			message: "未確定の評価シートが残っているため、評価期間を締められません。",
		});
		expect(await states()).toEqual(BEFORE);
		expect(await audits()).toEqual([]);

		await actAs(db, 1);
		await rows("update public.evaluation_periods set allow_unfinalized_close = true where id = 1");
		expect(await close(1)).toBe(true);
		// 締めたシートは、その時点の状態のまま残る
		await db.exec("reset role");
		expect(await rows("select status from public.evaluation_sheets")).toEqual([
			{ status: "first_evaluated" },
		]);
		expect((await audits())[0].details).toMatchObject({
			unfinishedSheets: 1,
			allowUnfinalizedClose: true,
		});
	});

	it("refuses to close a period the screen saw as active once it no longer is", async () => {
		await actAs(db, 1);
		await close(1);
		// 別の Admin が先に締めたなど、画面で見ていたときから変わっていたら断る
		await actAs(db, 1);
		await expect(close(1)).rejects.toMatchObject({
			code: "40001",
			message: "この評価期間は実施中ではないため、締められません。画面を開き直してください。",
		});
		await expect(close(3)).rejects.toMatchObject({ code: "40001" });
		expect(await close(999)).toBe(false);
		expect(await audits()).toHaveLength(1);
	});
});

describe("only an Admin who can use the app closes and starts periods", () => {
	it.each([
		["a Reviewer", 2],
		["an Employee", 4],
		["someone not signed in", 0],
	])("refuses %s", async (_who, id) => {
		await actAs(db, id);
		await expect(close(1)).rejects.toMatchObject({ code: "42501" });
		await actAs(db, id);
		await expect(start(3)).rejects.toMatchObject({ code: "42501" });
		expect(await states()).toEqual(BEFORE);
		expect(await audits()).toEqual([]);
	});

	it("refuses a suspended Admin", async () => {
		await db.exec("reset role; update public.employees set is_enabled = false where id = 1");
		await actAs(db, 1);
		await expect(close(1)).rejects.toMatchObject({ code: "42501" });
		expect(await states()).toEqual(BEFORE);
		expect(await audits()).toEqual([]);
	});

	it("cannot close or start a period by writing the table directly", async () => {
		for (const id of [1, 4]) {
			await actAs(db, id);
			await expect(
				rows(
					"update public.evaluation_periods set is_active = false, closed_at = now() where id = 1",
				),
			).rejects.toMatchObject({ code: "42501" });
			await actAs(db, id);
			await expect(
				rows("update public.evaluation_periods set is_active = true where id = 3"),
			).rejects.toMatchObject({ code: "42501" });
		}
		expect(await states()).toEqual(BEFORE);
	});
});

describe("nothing changes when the audit cannot be written", () => {
	const failAudit = () =>
		db.exec(`reset role;
			create function public.reject_period_audit() returns trigger language plpgsql as $$
			begin if new.action like 'period.%' then raise exception 'audit failed'; end if; return new; end $$;
			create trigger reject_period_audit before insert on public.security_audit_log
			for each row execute function public.reject_period_audit();`);
	const restoreAudit = () =>
		db.exec(
			"reset role; drop trigger reject_period_audit on public.security_audit_log; drop function public.reject_period_audit()",
		);

	it("keeps the period active when recording the close fails", async () => {
		await failAudit();
		try {
			await actAs(db, 1);
			await expect(close(1)).rejects.toThrow("audit failed");
			expect(await states()).toEqual(BEFORE);
		} finally {
			await restoreAudit();
		}
	});

	it("keeps the preparing period unstarted when recording the start fails", async () => {
		await actAs(db, 1);
		await close(1);
		await failAudit();
		try {
			await actAs(db, 1);
			await expect(start(3)).rejects.toThrow("audit failed");
			expect(await states()).toEqual(["1:締め済み", "2:締め済み", "3:未開始", "4:未開始"]);
		} finally {
			await restoreAudit();
		}
	});
});

it("creates no sheet while the next period is only preparing", async () => {
	await actAs(db, 1);
	await close(1);
	await actAs(db, 5);
	await expect(
		rows(
			"insert into public.evaluation_sheets (period_id, employee_id) values (3, 5) returning id",
		),
	).rejects.toThrow();
	await db.exec("reset role");
	expect(await rows("select id from public.evaluation_sheets where period_id = 3")).toEqual([]);
});
