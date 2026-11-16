import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "../prodLikeDb";

// ASVS v5.0.0: V8.2.1–3, V8.3.1, V16.3.3.
// 締めを越えて書く Admin の操作(遡及処理・特権操作・等級の変更・締め済みの評価期間への取込)は、攻撃者の的になる。
// UI を通さずに攻撃者の DB ロールで、呼ぶ人・印の偽造・RPC を通さない書き込み・例外の残り・監査の改ざんを試し、
// 毎回オーナーで「何も変わっていない」ことまで確かめる。
// このテストの DB の行ポリシーは全開(prodLikeDb)なので、行が見えないから守られた、ということにはならない。
let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;

// 期間 1 は実施中、2 は締め済み。
// 100: 締め済みの期間に残った社員 4 の下書き(評価を確定せずに締めた、または締め済みへの取込で作った)
// 200: 締め済みの期間の、社員 6 の確定したシート / 300: 実施中の期間の、社員 4 の提出済みのシート
const CLOSED_SHEETS = [100, 200] as const;
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
		truncate public.privileged_sheet_context;
		alter table public.employees disable trigger user;
		update public.employees set is_enabled = true;
		alter table public.employees enable trigger user;
		set session_replication_role = replica;
		insert into public.evaluation_sheets (id, period_id, employee_id, status, primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator, grade_id, item_set_id)
		values (100, 2, 4, 'draft', 2, 3, false, 1, 1),
		       (200, 2, 6, 'finalized', 2, null, true, 1, 1),
		       (300, 1, 4, 'submitted', 2, 3, false, 1, 1);
		insert into public.milestones (id, sheet_id, goal_number, challenge_goal, first_score, second_score)
		values (100, 100, 1, '締めた期間の目標', 3, 0), (200, 200, 1, '確定した目標', 4, 0), (300, 300, 1, '今期の目標', 0, 0);
		insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
		values (100, 1, 3, 0, '下書きの評価'), (200, 1, 4, 0, '確定した評価');
		set session_replication_role = origin;`);
});

/** 締めを越えて変わりうるものすべて。オーナーで読む。 */
const snapshot = async () => {
	await db.exec("reset role");
	return {
		sheets: await rows(
			"select id, period_id, employee_id, status, grade_id, item_set_id, total_evaluation_score from public.evaluation_sheets order by id",
		),
		goals: await rows(
			"select id, sheet_id, goal_number, challenge_goal, period_goals, achievement, first_score, second_score from public.milestones order by id",
		),
		common: await rows(
			"select sheet_id, item_id, first_score, second_score, first_comment from public.common_evaluation_results order by sheet_id, item_id",
		),
		corrections: await rows("select * from public.sheet_corrections order by id"),
		audits: await rows(
			"select id, action, entity_id, details from public.security_audit_log order by id",
		),
		exemptions: await rows("select * from public.privileged_sheet_context"),
	};
};

const suspendAdmin = () =>
	db.exec(
		"reset role; alter table public.employees disable trigger user; update public.employees set is_enabled = false where id = 1; alter table public.employees enable trigger user",
	);

/** 締めを越えて書く(読む) Admin 専用の入口。引数はどれも、Admin なら通る値。 */
const PRIVILEGED_CALLS: readonly [string, string, unknown[]][] = [
	[
		"retroactive correction",
		"select public.correct_closed_sheet($1, $2::jsonb, $3)",
		[
			200,
			JSON.stringify([{ target: "sheet", field: "first_overall_comment", value: "書き換え" }]),
			"攻撃",
		],
	],
	["reading a closed sheet for correction", "select public.get_sheet_for_correction($1)", [200]],
	[
		"privileged delete",
		"select public.privileged_sheet_operation($1, $2, $3, $4, $5)",
		[100, "delete", null, "draft", "攻撃"],
	],
	[
		"privileged status change",
		"select public.privileged_sheet_operation($1, $2, $3, $4, $5)",
		[200, "changeStatus", "draft", "finalized", "攻撃"],
	],
	[
		"grade change",
		"select public.change_sheet_grade($1, $2, $3, $4, $5)",
		[300, 2, 1, "submitted", "攻撃"],
	],
	[
		"import into a closed period",
		"select public.import_sheet_data($1, $2::jsonb, $3::jsonb, $4, $5)",
		[
			2,
			JSON.stringify([
				{ line: 2, employeeNo: "E5", goalNumber: "1", challengeGoal: "注入", firstScore: "4" },
			]),
			"[]",
			true,
			true,
		],
	],
	["import template of a closed period", "select public.get_sheet_import_template($1)", [2]],
];

describe.each(PRIVILEGED_CALLS)("%s", (_, sql, params) => {
	it.each([
		["anonymous", 0],
		["an employee", 4],
		["the primary evaluator", 2],
		["the secondary evaluator", 3],
		["an unrelated employee", 5],
		["an account without an employee", 99],
	])("is refused to %s, and nothing changes", async (_actor, actor) => {
		const before = await snapshot();
		await actAs(db, actor);
		await expect(rows(sql, params)).rejects.toMatchObject({ code: "42501" });
		expect(await snapshot()).toEqual(before);
	});

	it("is refused to a suspended Admin with the same session, and nothing changes", async () => {
		await suspendAdmin();
		const before = await snapshot();
		await actAs(db, 1);
		await expect(rows(sql, params)).rejects.toMatchObject({ code: "42501" });
		expect(await snapshot()).toEqual(before);
	});
});

it.each([
	"privileged_sheet_context",
	"is_privileged_sheet_operation(100)",
	"lock_import_period(2)",
])("keeps the inner workings of the exemption out of every caller's reach: %s", async (target) => {
	for (const actor of [0, 4, 1]) {
		await actAs(db, actor);
		const sql = target.includes("(")
			? `select public.${target}`
			: "insert into public.privileged_sheet_context values (txid_current(), 100)";
		await expect(rows(sql), `${actor}: ${sql}`).rejects.toMatchObject({ code: "42501" });
	}
});

it.each([4, 6, 2, 3, 5, 1])(
	"ignores forged correction and privilege marks: actor %s cannot write a closed sheet directly",
	async (actor) => {
		const before = await snapshot();
		for (const sheet of CLOSED_SHEETS) {
			await actAs(db, actor);
			// トリガーを止める設定は、ログインしたロールには変えられない
			await expect(
				rows("select set_config('session_replication_role', 'replica', false)"),
			).rejects.toMatchObject({ code: "42501" });
			// クライアントが立てられる印。どれも特権の根拠にしてはいけない
			await rows(
				"select set_config('typa.correcting_sheet', $1, false), set_config('typa.privileged_sheet', $1, false)",
				[String(sheet)],
			);
			for (const write of [
				"insert into public.milestones (sheet_id, goal_number, challenge_goal) values ($1, 4, '注入')",
				"update public.milestones set challenge_goal = '改ざん', first_score = 1, second_score = 1 where sheet_id = $1",
				"delete from public.milestones where sheet_id = $1",
				"insert into public.common_evaluation_results (sheet_id, item_id, first_score) values ($1, 2, 4)",
				"update public.common_evaluation_results set first_score = 1, first_comment = '改ざん' where sheet_id = $1",
				"delete from public.common_evaluation_results where sheet_id = $1",
				"update public.evaluation_sheets set status = 'draft', total_evaluation_score = 100 where id = $1",
				"delete from public.evaluation_sheets where id = $1",
			]) {
				// 断られるか、0行で終わる。どちらでも変わっていないことを最後にオーナーで確かめる
				await rows(write, [sheet]).catch(() => undefined);
			}
			await rows(
				"insert into public.evaluation_sheets (period_id, employee_id) values (2, 5)",
			).catch(() => undefined);
		}
		expect(await snapshot()).toEqual(before);
	},
);

it("refuses even a write that skips row security, unless an Admin RPC opened the sheet", async () => {
	// 行の権限を持たないオーナー(service_role 相当の誤ったコード)でも、締めた評価期間のトリガーが断る
	await db.exec("reset role");
	await rows("select set_config('typa.correcting_sheet', '100', false)");
	for (const write of [
		"insert into public.milestones (sheet_id, goal_number, challenge_goal) values (100, 4, '注入')",
		"update public.milestones set first_score = 1 where sheet_id = 100",
		"update public.evaluation_sheets set first_overall_comment = '改ざん' where id = 100",
		"delete from public.milestones where sheet_id = 100",
	]) {
		await expect(rows(write), write).rejects.toThrow(
			"締められた評価期間の評価シートは変更できません。",
		);
	}
	await rows("select set_config('typa.correcting_sheet', '', false)");
});

describe("no exemption outlives the Admin operation in the same transaction", () => {
	it.each([
		[
			"retroactive correction",
			"select public.correct_closed_sheet(200, $1::jsonb, '訂正')",
			[JSON.stringify([{ target: "sheet", field: "first_overall_comment", value: "訂正" }])],
		],
		[
			"privileged status change",
			"select public.privileged_sheet_operation(200, 'changeStatus', 'draft', 'finalized', '差し戻し')",
			[],
		],
		[
			"import into a closed period",
			"select public.import_sheet_data(2, $1::jsonb, '[]'::jsonb, true, true)",
			[JSON.stringify([{ line: 2, employeeNo: "E4", goalNumber: "1", challengeGoal: "取込" }])],
		],
	])("%s", async (_, sql, params) => {
		await actAs(db, 1);
		await db.exec("begin");
		try {
			await rows(sql, params);
			await db.exec("reset role");
			expect(await rows("select * from public.privileged_sheet_context")).toEqual([]);
			for (const sheet of CLOSED_SHEETS) {
				// 断られたらトランザクションが中断するので、1つずつ戻り点を置く
				await db.exec("savepoint attempt");
				await expect(
					rows("update public.milestones set first_score = 1 where sheet_id = $1", [sheet]),
				).rejects.toThrow("締められた評価期間の評価シートは変更できません。");
				await db.exec("rollback to savepoint attempt");
			}
		} finally {
			await db.exec("rollback");
		}
	});
});

it.each([0, 4, 2, 1])("never lets actor %s alter or erase the audit trail", async (actor) => {
	await actAs(db, 1);
	await rows("select public.correct_closed_sheet(200, $1::jsonb, '訂正')", [
		JSON.stringify([{ target: "sheet", field: "first_overall_comment", value: "訂正" }]),
	]);
	const before = await snapshot();
	expect(before.audits).toHaveLength(1);
	await actAs(db, actor);
	for (const write of [
		"update public.security_audit_log set details = '{}'",
		"delete from public.security_audit_log",
		"truncate public.security_audit_log",
		"insert into public.security_audit_log (actor_user_id, action, entity_id, details) values (null, 'sheet.corrected', 200, '{}')",
		"update public.sheet_corrections set reason = '改ざん'",
		"delete from public.sheet_corrections",
	]) {
		await expect(rows(write), write).rejects.toMatchObject({ code: "42501" });
	}
	expect(await snapshot()).toEqual(before);
});
