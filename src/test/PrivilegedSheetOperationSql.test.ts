import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { EVALUATION_STATUS_VALUES } from "../domain/valueObjects/EvaluationStatus";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const operate = (
	id: number,
	action: string,
	status: string | null,
	expected = "draft",
	reason = "再現テスト",
) =>
	rows("select public.privileged_sheet_operation($1,$2,$3,$4,$5)", [
		id,
		action,
		status,
		expected,
		reason,
	]);
beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
afterAll(async () => {
	await db?.close();
});
beforeEach(async () => {
	await db.exec(`reset role;
		truncate public.evaluation_sheets cascade;
		truncate public.security_audit_log;
		set session_replication_role=replica;
		update public.employees set is_enabled=true;
		insert into public.evaluation_sheets(id,period_id,employee_id,status,primary_evaluator_id,secondary_evaluator_id,grade_id)
		values(100,1,4,'draft',2,3,1),(200,2,4,'finalized',2,3,1);
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal,first_score,second_score)
		values(100,100,1,'',0,0),(200,200,1,'',0,0);
		insert into public.common_evaluation_results(sheet_id,item_id,first_score,second_score)
		values(200,1,2,3);
		insert into public.sheet_corrections(sheet_id,target,target_id,goal_number,field,before_value,after_value,reason,corrected_by)
		values(200,'goal',200,1,'challenge_goal','旧','新','訂正',1);
		set session_replication_role=origin;`);
});

it.each([0, 2, 3, 4, 5, 99])(
	"denies non-admin actor %s even through a direct RPC",
	async (actor) => {
		await actAs(db, actor);
		await expect(operate(100, "delete", null)).rejects.toMatchObject({ code: "42501" });
		await expect(operate(100, "changeStatus", "finalized")).rejects.toMatchObject({
			code: "42501",
		});
	},
);
it("denies a suspended Admin", async () => {
	await db.exec(
		"alter table public.employees disable trigger user; update public.employees set is_enabled=false where id=1; alter table public.employees enable trigger user",
	);
	await actAs(db, 1);
	await expect(operate(100, "delete", null)).rejects.toMatchObject({ code: "42501" });
});
it.each(EVALUATION_STATUS_VALUES)(
	"forces %s without approvals, complete scores or notifications",
	async (status) => {
		await actAs(db, 1);
		const id = status === "finalized" ? 100 : 200;
		const from = id === 100 ? "draft" : "finalized";
		await operate(id, "changeStatus", status, from);
		await db.exec("reset role");
		expect(await rows("select status from public.evaluation_sheets where id=$1", [id])).toEqual([
			{ status },
		]);
		expect(await rows("select id from public.notifications")).toEqual([]);
		expect(
			await rows<{ actor_user_id: string; details: Record<string, unknown> }>(
				"select actor_user_id,details from public.security_audit_log where action='sheet.privileged_status'",
			),
		).toEqual([
			expect.objectContaining({
				actor_user_id: uid(1),
				details: expect.objectContaining({
					from,
					to: status,
					actorEmployeeId: 1,
					reason: "再現テスト",
					periodId: id === 100 ? 1 : 2,
					employeeId: 4,
				}),
			}),
		]);
		await db.exec("reset role");
		expect(await rows("select * from public.privileged_sheet_context")).toEqual([]);
	},
);
it.each([100, 200])(
	"deletes sheet %s and keeps its content and corrections in the audit",
	async (id) => {
		await actAs(db, 1);
		await operate(id, "delete", null, id === 100 ? "draft" : "finalized");
		await db.exec("reset role");
		expect(await rows("select id from public.evaluation_sheets where id=$1", [id])).toEqual([]);
		const [audit] = await rows<{
			details: { snapshot: { sheet: { id: number }; goals: unknown[]; corrections: unknown[] } };
		}>(
			"select details from public.security_audit_log where action='sheet.privileged_delete' and entity_id=$1",
			[id],
		);
		expect(audit.details.snapshot.sheet.id).toBe(id);
		expect(audit.details.snapshot.goals).toHaveLength(1);
		expect(audit.details.snapshot.corrections).toHaveLength(id === 200 ? 1 : 0);
		await db.exec("reset role");
		expect(await rows("select id from public.milestones where sheet_id=$1", [id])).toEqual([]);
		expect(
			await rows("select id from public.common_evaluation_results where sheet_id=$1", [id]),
		).toEqual([]);
	},
);
it.each([
	[100, "changeStatus", "unknown", "draft", "理由"],
	[100, "unknown", null, "draft", "理由"],
	[100, "delete", "draft", "draft", "理由"],
	[100, "changeStatus", "draft", "draft", "理由"],
	[100, "delete", null, "draft", "   "],
	[100, "delete", null, "draft", "理".repeat(501)],
	[100, "delete", null, "submitted", "理由"],
	[999, "delete", null, "draft", "理由"],
] as const)(
	"rejects invalid or stale requests atomically (%s %s %s)",
	async (id, action, status, expected, reason) => {
		await actAs(db, 1);
		await expect(operate(id, action, status, expected, reason)).rejects.toThrow();
		expect(await rows("select id from public.security_audit_log")).toEqual([]);
	},
);
it("cannot forge the bypass or mutate the audit log through the normal API", async () => {
	await actAs(db, 1);
	await db.exec("select set_config('typa.privileged_sheet','200',false)");
	await expect(
		rows("insert into public.privileged_sheet_context values(txid_current(),200)"),
	).rejects.toMatchObject({ code: "42501" });
	await expect(rows("delete from public.security_audit_log")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(
		rows("select public.transition_evaluation_sheet(200,'draft')"),
	).rejects.toMatchObject({ code: "42501" });
	await operate(200, "changeStatus", "draft", "finalized");
	await actAs(db, 4);
	await expect(
		rows("update public.milestones set challenge_goal='changed' where sheet_id=200"),
	).rejects.toThrow();
});
it.each(["delete", "changeStatus"])(
	"rolls %s back if the audit cannot be written",
	async (action) => {
		await db.exec(`create function public.reject_privileged_audit() returns trigger language plpgsql as $$
		begin if new.action like 'sheet.privileged_%' then raise exception 'audit failed'; end if; return new; end $$;
		create trigger reject_privileged_audit before insert on public.security_audit_log for each row execute function public.reject_privileged_audit();`);
		try {
			await actAs(db, 1);
			await expect(
				operate(200, action, action === "delete" ? null : "draft", "finalized"),
			).rejects.toThrow("audit failed");
			await db.exec("reset role");
			expect(await rows("select id from public.evaluation_sheets where id=200")).toEqual([
				{ id: 200 },
			]);
			expect(await rows("select id from public.sheet_corrections where sheet_id=200")).toHaveLength(
				1,
			);
			expect(await rows("select * from public.privileged_sheet_context")).toEqual([]);
			expect(await rows("select status from public.evaluation_sheets where id=200")).toEqual([
				{ status: "finalized" },
			]);
		} finally {
			await db.exec(
				"reset role; drop trigger reject_privileged_audit on public.security_audit_log; drop function public.reject_privileged_audit()",
			);
		}
	},
);

it("withdraws the old request without notifying, and restores normal notification behavior afterwards", async () => {
	await actAs(db, 4);
	await rows("update public.milestones set challenge_goal='目標' where sheet_id=100");
	await rows("select public.transition_evaluation_sheet(100,'goals_submitted')");
	await db.exec("reset role");
	expect(await rows("select id from public.notifications where read_at is null")).toHaveLength(1);
	await actAs(db, 1);
	await operate(100, "changeStatus", "goals_confirmed", "goals_submitted");
	await db.exec("reset role");
	expect(await rows("select id from public.notifications")).toEqual([]);
	expect(await rows("select * from public.sheet_notification_deliveries")).toEqual([]);
	await actAs(db, 4);
	await rows("select public.transition_evaluation_sheet(100,'submitted')");
	await db.exec("reset role");
	expect(await rows("select kind,recipient_employee_id from public.notifications")).toEqual([
		{ kind: "submitted", recipient_employee_id: 2 },
	]);
});

it("unfreezes old aggregates on a backward move, and derives new aggregates when forced to finalization", async () => {
	await actAs(db, 1);
	await operate(200, "changeStatus", "draft", "finalized");
	await db.exec("reset role");
	expect(
		await rows(
			"select total_evaluation_score,first_rank,final_rank_letter from public.evaluation_sheets where id=200",
		),
	).toEqual([{ total_evaluation_score: null, first_rank: null, final_rank_letter: null }]);
	await actAs(db, 1);
	await operate(200, "changeStatus", "finalized");
	await db.exec("reset role");
	// 目標は0点、共通評価は item1(重み2)の二次3点だけ。6/20 × 80 = 24点。
	expect(
		await rows(
			"select total_evaluation_score,final_rank_letter from public.evaluation_sheets where id=200",
		),
	).toEqual([{ total_evaluation_score: 24, final_rank_letter: "D" }]);
	expect(
		await rows(
			"select is_active,closed_at is not null as closed from public.evaluation_periods where id=2",
		),
	).toEqual([{ is_active: false, closed: true }]);
});
