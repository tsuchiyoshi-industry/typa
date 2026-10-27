import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EVALUATION_STATUS_VALUES } from "../../domain/valueObjects/EvaluationStatus";
import { actAs, createProdLikeDb, uid } from "../prodLikeDb";

// ASVS v5.0.0: V8.2.1–3, V8.3.1–2, V2.3.1, V16.4.2.
// 最新までの全マイグレーションを適用し、UIを通さず攻撃者のDBロールで操作する。
let db: PGlite;
const denied = { code: "42501" };
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const document = async () => (await rows<{ v: unknown }>("select public.get_sheet(100) as v"))[0].v;
const transition = (status: string) =>
	rows("select public.transition_evaluation_sheet(100,$1)", [status]);

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
		insert into public.evaluation_sheets(id,period_id,employee_id) values(100,1,4),(200,1,5);
		insert into public.milestones(id,sheet_id,goal_number,challenge_goal)
		values(100,100,1,'confidential-goal'),(200,200,1,'other-goal');`);
});

describe.each(EVALUATION_STATUS_VALUES)("BOLA: sheet status %s", (status) => {
	it.each([1, 5, 99])(
		"does not disclose or mutate another employee's sheet as actor %s",
		async (actor) => {
			await db.exec("alter table public.evaluation_sheets disable trigger user");
			await db.query("update public.evaluation_sheets set status=$1 where id=100", [status]);
			await db.exec("alter table public.evaluation_sheets enable trigger user");
			await actAs(db, actor);
			expect(await document()).toBeNull();
			await expect(transition("finalized")).rejects.toMatchObject(denied);
			await expect(rows("select public.save_common_evaluation(100,'[]')")).rejects.toMatchObject(
				denied,
			);
			expect(
				await rows(
					"update public.milestones set challenge_goal='stolen' where id=100 returning id",
				),
			).toEqual([]);
			// オーナーで確認し、0件更新というレスポンスだけに依存しない。
			await db.exec("reset role");
			expect(await rows("select challenge_goal from public.milestones where id=100")).toEqual([
				{ challenge_goal: "confidential-goal" },
			]);
			expect(await rows("select status from public.evaluation_sheets where id=100")).toEqual([
				{ status },
			]);
		},
	);
});

it("permits the owner to read and write the draft (positive control)", async () => {
	await actAs(db, 4);
	expect(await document()).toMatchObject({
		objectives: [expect.objectContaining({ challengeGoal: "confidential-goal" })],
	});
	expect(
		await rows(
			"update public.milestones set challenge_goal='legitimate' where id=100 returning id",
		),
	).toEqual([{ id: 100 }]);
});

it.each([
	"get_sheet(100)",
	"transition_evaluation_sheet(100,'goals_submitted')",
	"save_common_evaluation(100,'[]')",
])("requires authentication for %s", async (call) => {
	await actAs(db, 0);
	await expect(rows(`select public.${call}`)).rejects.toMatchObject(denied);
});

it.each([0, 2, 3, 4, 5, 99])("BFLA: actor %s cannot administer employees", async (actor) => {
	await actAs(db, actor);
	for (const call of [
		"set_employee_role('E5','Admin')",
		"set_employee_enabled('E5',false)",
		"issue_employee_invitation('E7')",
		"reset_employee_registration('E5')",
		"import_sheet_data('[]','[]',true)",
		"privileged_sheet_operation(100,'delete',null,'draft','attack')",
	]) {
		await expect(rows(`select public.${call}`), call).rejects.toMatchObject(denied);
	}
	await db.exec("reset role");
	expect(await rows("select role_id,is_enabled from public.employees where id=5")).toEqual([
		{ role_id: 1, is_enabled: true },
	]);
	expect(await rows("select id from public.evaluation_sheets where id=100")).toEqual([{ id: 100 }]);
});

it.each(["role_id=3", "user_id=null", "is_enabled=false", "employee_no='E1000'"])(
	"mass assignment: rejects an allowed evaluator edit mixed with %s atomically",
	async (assignment) => {
		await actAs(db, 1);
		await expect(
			rows(`update public.employees set primary_evaluator_id=3,${assignment} where id=5`),
		).rejects.toMatchObject(denied);
		await db.exec("reset role");
		expect(
			await rows(
				"select primary_evaluator_id,role_id,user_id,is_enabled,employee_no from public.employees where id=5",
			),
		).toEqual([
			{
				primary_evaluator_id: null,
				role_id: 1,
				user_id: uid(5),
				is_enabled: true,
				employee_no: "E5",
			},
		]);
	},
);

it.each(["first_score=4", "second_score=4", "sheet_id=200"])(
	"mass assignment: rejects an owner goal edit mixed with %s atomically",
	async (assignment) => {
		await actAs(db, 4);
		await expect(
			rows(`update public.milestones set challenge_goal='attack',${assignment} where id=100`),
		).rejects.toMatchObject(denied);
		await db.exec("reset role");
		expect(
			await rows(
				"select sheet_id,challenge_goal,first_score,second_score from public.milestones where id=100",
			),
		).toEqual([
			{ sheet_id: 100, challenge_goal: "confidential-goal", first_score: 0, second_score: 0 },
		]);
	},
);

it.each([1, 2, 3, 4, 5, 99])("never exposes the SMTP password to actor %s", async (actor) => {
	await actAs(db, actor);
	await expect(rows("select smtp_password from public.workspace_settings")).rejects.toMatchObject(
		denied,
	);
	// 旧クライアント向けの秘密取得RPCは、最新マイグレーションで削除済み。
	await expect(rows("select public.get_notification_smtp_settings()")).rejects.toMatchObject({
		code: "42883",
	});
	await expect(
		rows("select public.claim_sheet_notification(100,$1)", [uid(4)]),
	).rejects.toMatchObject(denied);
});

it.each([1, 2, 4])(
	"protects audit records against append, change and deletion by actor %s",
	async (actor) => {
		await actAs(db, actor);
		for (const sql of [
			"insert into public.security_audit_log(action) values('forged')",
			"update public.security_audit_log set action='forged'",
			"delete from public.security_audit_log",
		]) {
			await expect(rows(sql)).rejects.toMatchObject(denied);
		}
	},
);

it("revokes a suspended owner's read/write access while retaining the same JWT subject", async () => {
	await actAs(db, 4);
	expect(await document()).not.toBeNull();
	// 管理処理の後も本人の認証クレームは差し替えない。
	await db.exec(
		"reset role; update public.employees set is_enabled=false where id=4; set role authenticated",
	);
	try {
		expect(await document()).toBeNull();
		expect(
			await rows("update public.milestones set challenge_goal='attack' where id=100 returning id"),
		).toEqual([]);
		await expect(transition("goals_submitted")).rejects.toMatchObject(denied);
	} finally {
		await db.exec("reset role; update public.employees set is_enabled=true where id=4");
	}
});

it.each(["submitted", "first_evaluated", "finalized"])(
	"prevents skipping goal approval directly to %s",
	async (status) => {
		await actAs(db, 4);
		await expect(transition(status)).rejects.toMatchObject(denied);
		await db.exec("reset role");
		expect(await rows("select status from public.evaluation_sheets where id=100")).toEqual([
			{ status: "draft" },
		]);
		expect(await rows("select id from public.notifications")).toEqual([]);
	},
);

it("treats SQL metacharacters as data through production save and read RPCs", async () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: 評価されてはならない攻撃文字列。
	const attack = "'; update public.employees set role_id=3; -- ${7*7} {{7*7}}";
	await actAs(db, 4);
	await transition("goals_submitted");
	await actAs(db, 2);
	await transition("goals_confirmed");
	await actAs(db, 4);
	await transition("submitted");
	await actAs(db, 2);
	await rows("select public.save_common_evaluation(100,$1)", [
		JSON.stringify([{ itemId: 1, firstScore: 3, firstComment: attack }]),
	]);
	expect(await document()).toMatchObject({
		commonResults: expect.arrayContaining([expect.objectContaining({ firstComment: attack })]),
	});
	await db.exec("reset role");
	expect(await rows("select role_id from public.employees where id=4")).toEqual([{ role_id: 1 }]);
});

it("rolls back a mixed valid/invalid JSON evaluation batch", async () => {
	await actAs(db, 4);
	await transition("goals_submitted");
	await actAs(db, 2);
	await transition("goals_confirmed");
	await actAs(db, 4);
	await transition("submitted");
	await actAs(db, 2);
	await expect(
		rows("select public.save_common_evaluation(100,$1)", [
			JSON.stringify([
				{ itemId: 1, firstScore: 3, firstComment: "must-rollback" },
				{ itemId: 2, firstScore: "4); DROP TABLE employees;--" },
			]),
		]),
	).rejects.toMatchObject({ code: "23514" });
	await db.exec("reset role");
	expect(await rows("select id from public.common_evaluation_results where sheet_id=100")).toEqual(
		[],
	);
});

it("rejects a repeated approval request without creating duplicate notifications", async () => {
	await actAs(db, 4);
	await transition("goals_submitted");
	await expect(transition("goals_submitted")).rejects.toThrow();
	await db.exec("reset role");
	expect(
		await rows("select kind,recipient_employee_id from public.notifications where sheet_id=100"),
	).toEqual([{ kind: "goals_submitted", recipient_employee_id: 2 }]);
});
