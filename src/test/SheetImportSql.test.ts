import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const wordingMigration = readFileSync(
	new URL(
		"../../supabase/migrations/202610260001_goal_workflow_message_wording.sql",
		import.meta.url,
	),
	"utf8",
);
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
type Result = {
	errors: { file: string | null; line: number | null; message: string }[];
	summary: Record<string, unknown>;
	applied: boolean;
};
const runImport = async (goals: unknown[], common: unknown[], apply = true) =>
	(
		await query<{ r: Result }>("select public.import_sheet_data($1, $2, $3) as r", [
			JSON.stringify(goals),
			JSON.stringify(common),
			apply,
		])
	)[0].r;
const goal = (line: number, employeeNo: string, goalNumber: string, extra: object = {}) => ({
	line,
	employeeNo,
	name: "",
	goalNumber,
	challengeGoal: `目標${line}`,
	periodGoals: [],
	achievement: "",
	firstScore: "",
	secondScore: "",
	...extra,
});
const common = (line: number, employeeNo: string, itemId: string, extra: object = {}) => ({
	line,
	employeeNo,
	name: "",
	itemId,
	itemTitle: "",
	firstScore: "3",
	secondScore: "",
	comment: `コメント${line}`,
	...extra,
});

// 社員 4: 一次 2・二次 3 / 社員 6: 二次評価者なし / 社員 5 は今期のシートを提出済み
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(
		"reset role; insert into public.evaluation_sheets (period_id, employee_id, status) values (1, 5, 'submitted')",
	);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("can safely reapply the wording migration", async () => {
	await db.exec(wordingMigration);
});

it("lets only an Admin read the template or import", async () => {
	await actAs(db, 4);
	await expect(query("select public.get_sheet_import_template()")).rejects.toMatchObject({
		code: "42501",
	});
	await expect(runImport([goal(2, "E4", "1")], [])).rejects.toMatchObject({ code: "42501" });
});

it("lists the employees who can still be imported, with the common items of their grade", async () => {
	await actAs(db, 1);
	const [{ t }] = await query<{
		t: {
			periodName: string;
			maxGoals: number;
			employees: { employeeNo: string; items: unknown[] }[];
		};
	}>("select public.get_sheet_import_template() as t");
	expect(t.periodName).toBe("実施中");
	expect(t.maxGoals).toBe(4);
	// 提出済みの社員 5 は出さない
	expect(t.employees.map((e) => e.employeeNo)).toEqual(["E1", "E2", "E3", "E4", "E6", "E7"]);
	expect(t.employees[0].items).toEqual([
		{ id: 1, title: "協調性" },
		{ id: 2, title: "専門性" },
	]);
});

it("rejects every row when one is wrong, naming the file and line, and writes nothing", async () => {
	await actAs(db, 1);
	const result = await runImport(
		[
			goal(2, "E4", "1", { firstScore: "5" }),
			goal(3, "E4", "1"),
			goal(4, "E99", "1"),
			goal(5, "E6", "2", { name: "別人", secondScore: "3" }),
			goal(6, "E5", "1"),
			goal(7, "E4", "9", { challengeGoal: " ", firstScore: "abc" }),
			// 内容がすべて空欄の行は、社員番号が違っていても無視する
			goal(8, "nobody", "", { challengeGoal: "" }),
		],
		[common(2, "E4", "99"), common(3, "E4", "1", { itemTitle: "専門性" })],
	);
	expect(result.applied).toBe(false);
	expect(result.errors.map((e) => `${e.file}:${e.line} ${e.message}`)).toEqual([
		"goals:2 一次評価点は 1〜4 の数字か空欄にしてください(「5」)。",
		"goals:3 目標番号 1 が 2行目と重複しています。",
		"goals:4 社員番号「E99」の社員がいません(利用停止中の社員には取り込めません)。",
		"goals:5 氏名が社員マスタの「社員6」と違います。社員番号を確かめてください。",
		"goals:5 二次評価者がいない社員のため、二次評価点は入れられません。",
		"goals:6 この社員の、実施中の評価期間の評価シートは目標を送信済みのため、取り込めません。",
		"goals:7 目標番号は 1〜4 の数字で入力してください(「9」)。",
		"goals:7 チャレンジ目標が空欄です。",
		"goals:7 一次評価点は 1〜4 の数字か空欄にしてください(「abc」)。",
		"common:2 項目ID「99」は、この社員の等級の共通評価項目ではありません。",
		"common:3 項目名が「協調性」と違います。項目IDを確かめてください。",
	]);
	await db.exec("reset role");
	expect(await query("select 1 from public.evaluation_sheets where employee_id in (4, 6)")).toEqual(
		[],
	);
});

it("uses goal-submission wording when an empty goal is submitted", async () => {
	await db.exec("reset role");
	const [{ id }] = await query<{ id: number }>(
		"insert into public.evaluation_sheets (period_id, employee_id, status) values (1, 4, 'draft') returning id",
	);
	await query(
		"insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals) values ($1, 1, '', '[]'::jsonb)",
		[id],
	);

	try {
		await actAs(db, 4);
		await expect(
			query("update public.evaluation_sheets set status = 'goals_submitted' where id = $1", [id]),
		).rejects.toThrow(
			"チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。",
		);
	} finally {
		await db.exec("reset role");
		await query("delete from public.evaluation_sheets where id = $1", [id]);
	}
});

it("creates draft sheets with goals, scores and comments, and replaces them on a second import", async () => {
	await actAs(db, 1);
	const goals = [
		goal(2, "E4", "1", { name: "社員4", firstScore: "4", secondScore: "3" }),
		goal(3, "E4", "02", { periodGoals: [{ description: "手順を見直す", achievement: "達成" }] }),
	];
	const checked = await runImport(goals, [common(2, "E4", "2")], false);
	expect(checked).toEqual({
		errors: [],
		applied: false,
		summary: {
			periodName: "実施中",
			employees: 1,
			newSheets: 1,
			replacedSheets: 0,
			goals: 2,
			commonResults: 1,
		},
	});
	expect((await runImport(goals, [common(2, "E4", "2")])).applied).toBe(true);

	await db.exec("reset role");
	expect(
		await query(
			"select status, primary_evaluator_id, secondary_evaluator_id from public.evaluation_sheets where employee_id = 4",
		),
	).toEqual([{ status: "draft", primary_evaluator_id: 2, secondary_evaluator_id: 3 }]);
	expect(
		await query(`select goal_number, challenge_goal, period_goals, first_score, second_score
			from public.milestones m join public.evaluation_sheets s on s.id = m.sheet_id
			where s.employee_id = 4 order by goal_number`),
	).toEqual([
		{
			goal_number: 1,
			challenge_goal: "目標2",
			period_goals: [],
			first_score: 4,
			second_score: 3,
		},
		{
			goal_number: 2,
			challenge_goal: "目標3",
			period_goals: [{ description: "手順を見直す", achievement: "達成" }],
			first_score: 0,
			second_score: 0,
		},
	]);
	expect(
		await query(`select item_id, first_score, second_score, first_comment
			from public.common_evaluation_results r join public.evaluation_sheets s on s.id = r.sheet_id
			where s.employee_id = 4`),
	).toEqual([{ item_id: 2, first_score: 3, second_score: 0, first_comment: "コメント2" }]);

	// 2回目は、CSV に載った社員の目標を置き換える
	await actAs(db, 1);
	const again = await runImport([goal(2, "E4", "3")], []);
	expect(again.summary).toMatchObject({ newSheets: 0, replacedSheets: 1 });
	await db.exec("reset role");
	expect(
		await query(`select goal_number from public.milestones m join public.evaluation_sheets s on s.id = m.sheet_id
			where s.employee_id = 4`),
	).toEqual([{ goal_number: 3 }]);
	expect(
		await query("select action from public.security_audit_log where action = 'sheets.imported'"),
	).toHaveLength(2);
});

it("says so when there is nothing to import", async () => {
	await actAs(db, 1);
	const result = await runImport([goal(2, "E4", "1", { challengeGoal: "" })], []);
	expect(result.errors).toEqual([
		{
			file: null,
			line: null,
			message: "取り込む内容がありません。目標か共通評価を1行以上記入してください。",
		},
	]);
});

it("treats missing, empty or malformed rows as errors instead of failing", async () => {
	await actAs(db, 1);
	// 何も送られてこない
	expect(
		(await query<{ r: Result }>("select public.import_sheet_data(null, null, true) as r"))[0].r,
	).toMatchObject({
		applied: false,
		errors: [{ message: expect.stringContaining("取り込む内容がありません") }],
	});
	// 列が欠けた行・数字でない番号・前後に空白のある社員番号
	const result = await runImport(
		[
			{ line: 2, challengeGoal: "社員番号の無い目標" },
			{ line: 3, employeeNo: " E4 ", goalNumber: "一", challengeGoal: "番号が数字でない" },
			{ line: 4, employeeNo: "E4", goalNumber: "99999999999999999999", challengeGoal: "桁あふれ" },
		],
		[{ line: 2, employeeNo: "E4", itemId: "1; drop table x", comment: "項目IDが数字でない" }],
	);
	expect(result.applied).toBe(false);
	expect(result.errors.map((e) => `${e.file}:${e.line} ${e.message}`)).toEqual([
		"goals:2 社員番号が空欄です。",
		"goals:2 目標番号は 1〜4 の数字で入力してください(「」)。",
		"goals:3 目標番号は 1〜4 の数字で入力してください(「一」)。",
		"goals:4 目標番号は 1〜4 の数字で入力してください(「99999999999999999999」)。",
		"common:2 項目ID「1; drop table x」は、この社員の等級の共通評価項目ではありません。",
	]);
});

it("does not import into an employee whose use was suspended", async () => {
	await db.exec("reset role; update public.employees set is_enabled = false where id = 6");
	await actAs(db, 1);
	const result = await runImport([goal(2, "E6", "1")], []);
	expect(result.errors.map((e) => e.message)).toEqual([
		"社員番号「E6」の社員がいません(利用停止中の社員には取り込めません)。",
	]);
	await db.exec("reset role; update public.employees set is_enabled = true where id = 6");
});

it("refuses to import or hand out a template while no period is in progress", async () => {
	await db.exec("reset role; update public.evaluation_periods set is_active = false");
	await actAs(db, 1);
	await expect(query("select public.get_sheet_import_template()")).rejects.toMatchObject({
		code: "P0002",
	});
	await expect(runImport([goal(2, "E4", "1")], [])).rejects.toMatchObject({ code: "P0002" });
	await db.exec("reset role; update public.evaluation_periods set is_active = true where id = 1");
});

it("imports achievement directly on a challenge with zero period goals", async () => {
	await actAs(db, 1);
	expect(
		(await runImport([goal(2, "E6", "1", { achievement: "テーマへの実績" })], [])).applied,
	).toBe(true);
	await actAs(db, 6);
	const [{ value }] = await query<{
		value: { objectives: { achievement: string; periodGoals: unknown[] }[] };
	}>(
		"select public.get_sheet(id) as value from public.evaluation_sheets where period_id=1 and employee_id=6",
	);
	expect(value.objectives[0]).toMatchObject({ achievement: "テーマへの実績", periodGoals: [] });
});
