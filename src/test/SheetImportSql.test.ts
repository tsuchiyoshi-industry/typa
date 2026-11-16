import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb, rollbackAfterTest } from "./prodLikeDb";

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
type Result = {
	errors: { file: string | null; line: number | null; message: string }[];
	summary: Record<string, unknown>;
	applied: boolean;
};
/** 評価期間 1 は実施中、2 は締め済み。closedConfirmed は、締め済みと分かって取り込むと画面で確かめたか。 */
const runImport = async (
	goals: unknown[],
	common: unknown[],
	apply: boolean | null = true,
	{ period = 1 as number | null, closedConfirmed = false as boolean | null } = {},
) =>
	(
		await query<{ r: Result }>("select public.import_sheet_data($1, $2, $3, $4, $5) as r", [
			period,
			JSON.stringify(goals),
			JSON.stringify(common),
			apply,
			closedConfirmed,
		])
	)[0].r;
type Template = {
	periodName: string;
	maxGoals: number;
	employees: { employeeNo: string; items: unknown[] }[];
};
const template = async (period: number | null = 1) =>
	(await query<{ t: Template }>("select public.get_sheet_import_template($1) as t", [period]))[0].t;
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

// 202610260001 の文言の移行が書き換えた取込の関数(引数3つ)は、評価期間を選ぶ取込に置き換えて無くなった。
// 同じ移行が直した、目標の送信の文言だけを確かめる
it("uses goal-submission wording for an empty goal", async () => {
	await rollbackAfterTest(db);
	// 取込のテストが作った社員 4 のシートは、この確認の間だけ消す(終わると元に戻る)
	await db.exec(`reset role; set session_replication_role = replica;
		delete from public.evaluation_sheets where period_id = 1 and employee_id = 4;
		set session_replication_role = origin;`);
	const [{ id }] = await query<{ id: number }>(
		"insert into public.evaluation_sheets (period_id, employee_id, status) values (1, 4, 'draft') returning id",
	);
	await query(
		"insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals) values ($1, 1, '', '[]'::jsonb)",
		[id],
	);
	await actAs(db, 4);
	await expect(
		query("update public.evaluation_sheets set status = 'goals_submitted' where id = $1", [id]),
	).rejects.toThrow(
		"チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。",
	);
});

it("lets only an Admin read the template or import", async () => {
	await actAs(db, 4);
	await expect(template()).rejects.toMatchObject({ code: "42501" });
	await expect(runImport([goal(2, "E4", "1")], [])).rejects.toMatchObject({ code: "42501" });
});

it("lists the employees who can still be imported, with the common items of their grade", async () => {
	await actAs(db, 1);
	const t = await template();
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
	// 書かないことは、取り込む前と後の比較で確かめる(ほかのテストの取込もシートを作る)
	const written = async () => {
		await db.exec("reset role");
		return query(
			"select s.id, s.status, m.goal_number, m.challenge_goal from public.evaluation_sheets s left join public.milestones m on m.sheet_id = s.id where s.employee_id in (4, 6) order by s.id, m.goal_number",
		);
	};
	const before = await written();
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
		"goals:6 この社員の、この評価期間の評価シートは目標を送信済みのため、取り込めません。",
		"goals:7 目標番号は 1〜4 の数字で入力してください(「9」)。",
		"goals:7 チャレンジ目標が空欄です。",
		"goals:7 一次評価点は 1〜4 の数字か空欄にしてください(「abc」)。",
		"common:2 項目ID「99」は、この社員の等級の共通評価項目ではありません。",
		"common:3 項目名が「協調性」と違います。項目IDを確かめてください。",
	]);
	expect(await written()).toEqual(before);
});

it("creates draft sheets with goals, scores and comments, and replaces them on a second import", async () => {
	// 監査の記録は、このテストの取込の分だけを数える(ほかのテストの取込も同じ表に残る)
	const imports = async () => {
		await db.exec("reset role");
		return (
			await query("select action from public.security_audit_log where action = 'sheets.imported'")
		).length;
	};
	const importsBefore = await imports();
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
	// 確かめるだけ(apply なし)の取込は記録しない。書いた2回だけ
	expect((await imports()) - importsBefore).toBe(2);
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
		(
			await query<{ r: Result }>("select public.import_sheet_data(1, null, null, true, false) as r")
		)[0].r,
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

it("refuses a period that is missing or has not started, and writes nothing", async () => {
	await db.exec(`reset role; insert into public.evaluation_periods (id, period_name, start_date, end_date, is_active)
		values (3, '未開始', '2026-10-01', '2027-03-31', false)`);
	try {
		await actAs(db, 1);
		for (const period of [99, -1, null]) {
			await expect(template(period)).rejects.toMatchObject({ code: "P0002" });
			await expect(
				runImport([goal(2, "E4", "1")], [], true, { period, closedConfirmed: true }),
			).rejects.toMatchObject({ code: "P0002" });
		}
		// まだ始めていない評価期間には、確かめた(closedConfirmed)と送られても取り込まない
		await expect(template(3)).rejects.toThrow("実施中か締め済みの評価期間だけ");
		await expect(
			runImport([goal(2, "E4", "1")], [], true, { period: 3, closedConfirmed: true }),
		).rejects.toMatchObject({ code: "23514" });
		await db.exec("reset role");
		expect(await query("select id from public.evaluation_sheets where period_id = 3")).toEqual([]);
	} finally {
		await db.exec("reset role; delete from public.evaluation_periods where id = 3");
	}
});

// 締め済みの評価期間への取込は、締めを越えて書く特権操作。攻撃の的になる前提で、侵入面ごとに確かめる
describe("importing into a closed period chosen on the screen", () => {
	const snapshot = async () => {
		await db.exec("reset role");
		return {
			sheets: await query(
				`select s.id, s.period_id, s.employee_id, s.status,
					(select jsonb_agg(to_jsonb(m) - 'updated_at' order by m.goal_number) from public.milestones m where m.sheet_id = s.id) as goals,
					(select jsonb_agg(to_jsonb(r) - 'updated_at' order by r.item_id) from public.common_evaluation_results r where r.sheet_id = s.id) as common
				from public.evaluation_sheets s order by s.id`,
			),
			audits: await query("select id from public.security_audit_log order by id"),
			exemptions: await query("select * from public.privileged_sheet_context"),
		};
	};
	const closedSheets = async () => {
		await db.exec("reset role");
		return query<{ employee_id: number; status: string; goals: unknown; common: unknown }>(
			`select s.employee_id, s.status,
				(select jsonb_agg(jsonb_build_object('n', m.goal_number, 'goal', m.challenge_goal, 'first', m.first_score) order by m.goal_number)
				 from public.milestones m where m.sheet_id = s.id) as goals,
				(select jsonb_agg(jsonb_build_object('item', r.item_id, 'first', r.first_score) order by r.item_id)
				 from public.common_evaluation_results r where r.sheet_id = s.id) as common
			from public.evaluation_sheets s where s.period_id = 2 order by s.employee_id`,
		);
	};
	const imports = async () => {
		await db.exec("reset role");
		return query<{ entity_id: number; details: Record<string, unknown> }>(
			"select entity_id, details from public.security_audit_log where action = 'sheets.imported' order by id",
		);
	};
	const closedImport = (rows = [goal(2, "E4", "1", { firstScore: "4" })]) =>
		runImport(rows, [common(2, "E4", "1")], true, { period: 2, closedConfirmed: true });
	afterEach(async () => {
		await db.exec(`reset role; set session_replication_role = replica;
			delete from public.evaluation_sheets where period_id = 2;
			set session_replication_role = origin;`);
	});

	it("hands out the template of the closed period, listing everyone without a sent sheet there", async () => {
		await actAs(db, 1);
		const t = await template(2);
		expect(t.periodName).toBe("締め済み");
		// 実施中の評価期間で送信済みの社員 5 も、締め済みの評価期間にはシートがないので載る
		expect(t.employees.map((e) => e.employeeNo)).toEqual([
			"E1",
			"E2",
			"E3",
			"E4",
			"E5",
			"E6",
			"E7",
		]);
	});

	it("writes into the closed period, not the one in progress, and audits it with what it replaced", async () => {
		await db.exec("reset role");
		const activeBefore = (await snapshot()).sheets.filter((sheet) => sheet.period_id === 1);
		await actAs(db, 1);
		const checked = await runImport(
			[goal(2, "E5", "1", { firstScore: "4" }), goal(3, "E5", "2")],
			[common(2, "E5", "1")],
			false,
			{ period: 2 },
		);
		// 確かめるだけなら、締め済みと確かめていなくても答える(何も書かない)
		expect(checked).toMatchObject({
			errors: [],
			applied: false,
			summary: { periodName: "締め済み", employees: 1, newSheets: 1, replacedSheets: 0 },
		});
		expect(await closedSheets()).toEqual([]);

		await actAs(db, 1);
		const first = await runImport(
			[goal(2, "E5", "1", { firstScore: "4" }), goal(3, "E5", "2")],
			[common(2, "E5", "1")],
			true,
			{ period: 2, closedConfirmed: true },
		);
		expect(first).toMatchObject({ errors: [], applied: true, summary: { newSheets: 1 } });
		expect(await closedSheets()).toEqual([
			{
				employee_id: 5,
				status: "draft",
				goals: [
					{ n: 1, goal: "目標2", first: 4 },
					{ n: 2, goal: "目標3", first: 0 },
				],
				common: [{ item: 1, first: 3 }],
			},
		]);
		expect((await snapshot()).sheets.filter((sheet) => sheet.period_id === 1)).toEqual(
			activeBefore,
		);

		await actAs(db, 1);
		const second = await runImport([goal(2, "E5", "3", { firstScore: "2" })], [], true, {
			period: 2,
			closedConfirmed: true,
		});
		expect(second.summary).toMatchObject({ newSheets: 0, replacedSheets: 1 });
		const [created, replaced] = (await imports()).slice(-2);
		expect(created).toMatchObject({
			entity_id: 2,
			details: { periodId: 2, periodName: "締め済み", periodState: "closed", replaced: [] },
		});
		// 置き換えた目標は元の値のまま記録に残す。CSV に載せていない共通評価は置き換えず、記録もしない
		expect(replaced.details).toMatchObject({ periodState: "closed", replacedSheets: 1 });
		expect(replaced.details.replaced).toEqual([
			{
				sheetId: expect.any(Number),
				employeeNo: "E5",
				goals: [
					expect.objectContaining({ goal_number: 1, challenge_goal: "目標2", first_score: 4 }),
					expect.objectContaining({ goal_number: 2, challenge_goal: "目標3", first_score: 0 }),
				],
				commonResults: null,
			},
		]);
		expect(await closedSheets()).toMatchObject([
			{ goals: [{ n: 3, first: 2 }], common: [{ item: 1, first: 3 }] },
		]);
		// 実施中の評価期間への取込は、実施中と記録する
		await actAs(db, 1);
		await runImport([goal(2, "E7", "1")], []);
		expect((await imports()).slice(-1)[0]?.details).toMatchObject({
			periodId: 1,
			periodState: "active",
		});
	});

	it.each([
		["the screen did not know the period was closed", false],
		["the confirmation is missing (null)", null],
	])("writes nothing when %s", async (_, closedConfirmed) => {
		const before = await snapshot();
		await actAs(db, 1);
		await expect(
			runImport([goal(2, "E4", "1")], [common(2, "E4", "1")], true, {
				period: 2,
				closedConfirmed,
			}),
		).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("締め済み") });
		expect(await snapshot()).toEqual(before);
	});

	it("treats a missing apply flag (null) as checking only, never as writing", async () => {
		const before = await snapshot();
		await actAs(db, 1);
		const result = await runImport([goal(2, "E4", "1")], [], null, {
			period: 2,
			closedConfirmed: true,
		});
		expect(result.applied).toBe(false);
		expect(await snapshot()).toEqual(before);
	});

	it.each([
		["a non-array goals payload", '{"employeeNo":"E4"}', "[]"],
		["a scalar common payload", "[]", '"E4"'],
	])("rejects %s without writing", async (_, goals, commons) => {
		const before = await snapshot();
		await actAs(db, 1);
		await expect(
			query("select public.import_sheet_data(2, $1::jsonb, $2::jsonb, true, true)", [
				goals,
				commons,
			]),
		).rejects.toThrow();
		expect(await snapshot()).toEqual(before);
	});

	it.each([0, 2, 3, 4, 5, 99])(
		"denies actor %s (not an Admin) the closed period, even with the confirmation forged",
		async (actor) => {
			const before = await snapshot();
			await actAs(db, actor);
			await expect(template(2)).rejects.toMatchObject({ code: "42501" });
			await expect(closedImport()).rejects.toMatchObject({ code: "42501" });
			expect(await snapshot()).toEqual(before);
		},
	);

	it("denies a suspended Admin and an anonymous caller", async () => {
		const before = await snapshot();
		await db.exec(
			"reset role; alter table public.employees disable trigger user; update public.employees set is_enabled = false where id = 1; alter table public.employees enable trigger user",
		);
		try {
			await actAs(db, 1);
			await expect(template(2)).rejects.toMatchObject({ code: "42501" });
			await expect(closedImport()).rejects.toMatchObject({ code: "42501" });
		} finally {
			await db.exec(
				"reset role; alter table public.employees disable trigger user; update public.employees set is_enabled = true where id = 1; alter table public.employees enable trigger user",
			);
		}
		await db.exec("reset role; set role anon");
		await expect(closedImport()).rejects.toMatchObject({ code: "42501" });
		await expect(template(2)).rejects.toMatchObject({ code: "42501" });
		expect(await snapshot()).toEqual(before);
	});

	it("leaves the old entry without a period unusable, so an old client cannot skip the confirmation", async () => {
		await actAs(db, 1);
		await expect(
			query("select public.import_sheet_data('[]'::jsonb, '[]'::jsonb, true)"),
		).rejects.toMatchObject({ code: "42883" });
		await expect(query("select public.get_sheet_import_template()")).rejects.toMatchObject({
			code: "42883",
		});
	});

	it("leaves no exemption behind, even later in the same transaction", async () => {
		await actAs(db, 1);
		await db.exec("begin");
		try {
			await closedImport();
			// 取込の直後、同じトランザクションのまま RPC を通さずに書いても何も変わらない
			await query(
				"update public.milestones set first_score = 1 where sheet_id in (select id from public.evaluation_sheets where period_id = 2)",
			).catch(() => undefined);
			await db.exec("reset role");
			expect(await query("select * from public.privileged_sheet_context")).toEqual([]);
			expect(
				await query(
					"select m.first_score from public.milestones m join public.evaluation_sheets s on s.id = m.sheet_id where s.period_id = 2",
				),
			).toEqual([{ first_score: 4 }]);
			// 行の権限を持たない所有者として書いても、締めた評価期間のトリガーが断る(例外が残っていない)
			await expect(
				query(
					"update public.milestones set first_score = 1 where sheet_id in (select id from public.evaluation_sheets where period_id = 2)",
				),
			).rejects.toThrow("締められた評価期間の評価シートは変更できません。");
		} finally {
			await db.exec("rollback");
		}
		await actAs(db, 1);
		await closedImport();
		const before = await snapshot();
		expect(before.exemptions).toEqual([]);
		// 本人・評価者・Admin の誰も、RPC を通さずに締めた評価期間のシートを書けない。
		// 遡及処理の印(typa.correcting_sheet)や特権の印をクライアントが立てても同じ
		const [{ id: sheetId }] = await query<{ id: number }>(
			"select id from public.evaluation_sheets where period_id = 2 and employee_id = 4",
		);
		for (const actor of [4, 2, 3, 1]) {
			await actAs(db, actor);
			await db.exec(`select set_config('typa.correcting_sheet', '${sheetId}', false),
				set_config('typa.privileged_sheet', '${sheetId}', false)`);
			for (const write of [
				"update public.milestones set challenge_goal = 'x', first_score = 1 where sheet_id = $1",
				"delete from public.milestones where sheet_id = $1",
				"insert into public.milestones (sheet_id, goal_number, challenge_goal) values ($1, 4, 'x')",
				"update public.common_evaluation_results set first_score = 1 where sheet_id = $1",
				"update public.evaluation_sheets set status = 'finalized' where id = $1",
				"delete from public.evaluation_sheets where id = $1",
			]) {
				// 行が見えずに0件で終わるか、トリガーか権限が断る。どちらでも何も変わらない(下で確かめる)
				await query(write, [sheetId]).catch(() => undefined);
			}
			await expect(
				query("insert into public.privileged_sheet_context values (txid_current(), $1)", [sheetId]),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				query("select public.is_privileged_sheet_operation($1)", [sheetId]),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				query("insert into public.evaluation_sheets (period_id, employee_id) values (2, 7)"),
			).rejects.toThrow();
			await db.exec(
				"select set_config('typa.correcting_sheet', '', false), set_config('typa.privileged_sheet', '', false)",
			);
		}
		expect(await snapshot()).toEqual(before);
	});

	it("keeps the audit trail out of the Admin's reach", async () => {
		await actAs(db, 1);
		await closedImport();
		const before = await snapshot();
		await actAs(db, 1);
		for (const write of [
			"delete from public.security_audit_log where action = 'sheets.imported'",
			"update public.security_audit_log set details = '{}' where action = 'sheets.imported'",
			"insert into public.security_audit_log (actor_user_id, action, entity_id, details) values (null, 'sheets.imported', 2, '{}')",
		]) {
			await expect(query(write), write).rejects.toMatchObject({ code: "42501" });
		}
		expect(await snapshot()).toEqual(before);
	});

	it("does not overwrite a sheet already sent or finalized in the closed period", async () => {
		await db.exec(`reset role; set session_replication_role = replica;
			insert into public.evaluation_sheets (period_id, employee_id, status, grade_id, item_set_id) values (2, 4, 'finalized', 1, 1);
			set session_replication_role = origin;`);
		const before = await snapshot();
		await actAs(db, 1);
		const result = await runImport([goal(2, "E4", "1")], [common(2, "E4", "1")], true, {
			period: 2,
			closedConfirmed: true,
		});
		expect(result.applied).toBe(false);
		expect(result.errors.map((e) => e.message)).toEqual([
			"この社員の、この評価期間の評価シートは目標を送信済みのため、取り込めません。",
			"この社員の、この評価期間の評価シートは目標を送信済みのため、取り込めません。",
		]);
		expect(await snapshot()).toEqual(before);
	});

	it("rolls the whole import back when the audit cannot be written", async () => {
		const before = await snapshot();
		await db.exec(`reset role;
			create function public.refuse_import_audit() returns trigger language plpgsql as
			$$ begin raise exception 'audit store unavailable'; end $$;
			create trigger refuse_import_audit before insert on public.security_audit_log
			for each row execute function public.refuse_import_audit();`);
		try {
			await actAs(db, 1);
			await expect(closedImport()).rejects.toThrow("audit store unavailable");
		} finally {
			await db.exec(`reset role; drop trigger refuse_import_audit on public.security_audit_log;
				drop function public.refuse_import_audit();`);
		}
		expect(await snapshot()).toEqual(before);
	});
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
