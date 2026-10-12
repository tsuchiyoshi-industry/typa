import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvaluationAllocation } from "../domain/valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../domain/valueObjects/EvaluationRank";
import { actAs, createProdLikeDb } from "./prodLikeDb";

// 0.9.8 のアプリが動いたまま当てる範囲(アプリ更新後に当てる締め付けは含めない)
const PHASE_1 = "202610120003_z";
const DENIED = { code: "42501" };

let db: PGlite;
const rows = async <T>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const count = async (table: string) =>
	(await rows<{ n: number }>(`select count(*)::int as n from public.${table}`))[0].n;

// アプリ(PostgREST)が送る文と同じ形
const createSheet = async (employeeId: number, periodId = 1) =>
	(
		await rows<{ id: number }>(
			`insert into public.evaluation_sheets (period_id, employee_id) values ($1, $2)
			 on conflict (period_id, employee_id) do update set period_id = excluded.period_id, employee_id = excluded.employee_id
			 returning id`,
			[periodId, employeeId],
		)
	)[0].id;
const saveGoal = (sheetId: number, goalNumber: number, text = "目標") =>
	rows<{ id: number }>(
		`insert into public.milestones (sheet_id, goal_number, challenge_goal, midterm_goal, achievement)
		 values ($1, $2, $3, '', '')
		 on conflict (sheet_id, goal_number) do update set challenge_goal = excluded.challenge_goal,
		   midterm_goal = excluded.midterm_goal, achievement = excluded.achievement
		 returning id`,
		[sheetId, goalNumber, text],
	);
const saveFirst = (sheetId: number, itemId: number, score: number) =>
	db.query(
		`insert into public.common_evaluation_results (sheet_id, item_id, first_score, first_comment)
		 values ($1, $2, $3, 'コメント')
		 on conflict (sheet_id, item_id) do update set first_score = excluded.first_score, first_comment = excluded.first_comment`,
		[sheetId, itemId, score],
	);
const saveSecond = (sheetId: number, itemId: number, score: number) =>
	db.query(
		`insert into public.common_evaluation_results (sheet_id, item_id, second_score)
		 values ($1, $2, $3)
		 on conflict (sheet_id, item_id) do update set second_score = excluded.second_score`,
		[sheetId, itemId, score],
	);
const setStatus = (sheetId: number, status: string, extra = "") =>
	db.query(`update public.evaluation_sheets set status = $2 ${extra} where id = $1 returning id`, [
		sheetId,
		status,
	]);
/** アプリと同じ計算: 目標 2 件(各 goal 点)と、配点 2・3 の共通評価(各 common 点)、配点 20 / 80。 */
const score = (goal: number, common: number) =>
	EvaluationAllocation.fromTotal(20, goal * 2, 8) +
	EvaluationAllocation.fromTotal(80, common * 5, 20);
const rank = (total: number) => EvaluationRank.fromScore(total, 100);

beforeAll(async () => {
	db = await createProdLikeDb(PHASE_1);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

describe("before sign-in and without an employee", () => {
	it("gives anon the company domain and nothing else", async () => {
		await actAs(db, 0);
		expect(await rows("select public.get_required_domain() as domain")).toEqual([
			{ domain: "example.jp" },
		]);
		for (const table of [
			"employees",
			"roles",
			"evaluation_periods",
			"evaluation_sheets",
			"milestones",
			"common_evaluation_results",
			"evaluation_settings",
		]) {
			await expect(count(table), table).rejects.toMatchObject(DENIED);
		}
		await expect(
			db.query("update public.employees set user_id = null where id = 4"),
		).rejects.toMatchObject(DENIED);
		await expect(db.query("select public.current_employee_id()")).rejects.toMatchObject(DENIED);
		await expect(db.query("select public.get_reviewer_workspace(1)")).rejects.toMatchObject(DENIED);
	});

	it("shows an account that is no employee no people and no sheets", async () => {
		await actAs(db, 99);
		expect(await count("employees")).toBe(0);
		expect(await count("evaluation_sheets")).toBe(0);
		// 社員に成りすます・Admin になる経路がない
		await expect(
			db.query("update public.employees set user_id = auth.uid() where id = 7"),
		).rejects.toMatchObject(DENIED);
		await expect(
			db.query(
				"insert into public.employees (name, employee_no, role_id, user_id) values ('x', 'X1', 3, auth.uid())",
			),
		).rejects.toMatchObject(DENIED);
		await expect(db.query("delete from public.employees where id = 5")).rejects.toMatchObject(
			DENIED,
		);
		await expect(createSheet(4)).rejects.toMatchObject(DENIED);
	});
});

describe("the employee master", () => {
	it("shows an employee only the people they work with, and Admin and Reviewer everyone", async () => {
		const visible = async (id: number) => {
			await actAs(db, id);
			return (await rows<{ id: number }>("select id from public.employees order by id")).map(
				(row) => row.id,
			);
		};
		expect(await visible(5)).toEqual([5]);
		expect(await visible(4)).toEqual([2, 3, 4]);
		expect(await visible(6)).toEqual([2, 6]);
		expect(await visible(1)).toHaveLength(7);
		expect(await visible(2)).toHaveLength(7);
	});

	it("lets Admin and Reviewer assign evaluators, and only Admin change a grade", async () => {
		const assign = "update public.employees set primary_evaluator_id = 3 where id = 5 returning id";
		await actAs(db, 5);
		expect(await rows(assign)).toEqual([]);
		await actAs(db, 2);
		expect(await rows(assign)).toEqual([{ id: 5 }]);
		await expect(
			db.query("update public.employees set grade_id = 2 where id = 5"),
		).rejects.toMatchObject(DENIED);
		await expect(
			db.query("update public.employees set primary_evaluator_id = 5 where id = 5"),
		).rejects.toMatchObject({ code: "23514" });
		// 権限・アカウントの紐付け・氏名は、クライアントからは書けない
		for (const column of ["role_id = 3", "user_id = null", "name = 'x'", "employee_no = 'X'"]) {
			await expect(
				db.query(`update public.employees set ${column} where id = 2`),
				column,
			).rejects.toMatchObject(DENIED);
		}
		await actAs(db, 1);
		expect(
			await rows("update public.employees set grade_id = 2 where id = 5 returning grade_id"),
		).toEqual([{ grade_id: 2 }]);
		await db.exec(
			"reset role; update public.employees set primary_evaluator_id = null, grade_id = 1 where id = 5",
		);
	});
});

it("keeps the Admin-only settings working through the narrowed employee table", async () => {
	// 設定のポリシーは employees を読んで Admin かどうかを確かめる。employees を絞っても、自分の行は読める
	const save =
		"update public.evaluation_settings set objective_allocation = 30, common_allocation = 70 returning id";
	for (const person of [2, 4, 99]) {
		await actAs(db, person);
		expect(await rows(save), String(person)).toEqual([]);
		expect(await rows("select smtp_host from public.workspace_settings")).toEqual([]);
	}
	await actAs(db, 1);
	expect(await rows(save)).toHaveLength(1);
	expect(await rows("select smtp_host from public.workspace_settings")).toHaveLength(1);
	expect(await rows("select public.get_sheet_overview() as sheets")).toHaveLength(1);
	await db.exec(
		"reset role; update public.evaluation_settings set objective_allocation = 20, common_allocation = 80",
	);
});

describe("a sheet from draft to finalized", () => {
	let sheetId: number;
	let goalIds: number[];

	it("lets the subject create and fill their own draft, which evaluators cannot read yet", async () => {
		await actAs(db, 4);
		sheetId = await createSheet(4);
		expect(await createSheet(4)).toBe(sheetId);
		// 他人のシートは作れない
		await expect(createSheet(5)).rejects.toMatchObject(DENIED);
		goalIds = [(await saveGoal(sheetId, 1))[0].id, (await saveGoal(sheetId, 2))[0].id];
		expect((await saveGoal(sheetId, 2, "書き直し"))[0].id).toBe(goalIds[1]);
		// 0.9.8 までのアプリは、作成時に空の集計を保存する
		await db.query(
			`update public.evaluation_sheets set common_evaluation_first_total_score = 0, common_evaluation_first_total_rate = 0,
			   total_evaluation_score = 0, objective_allocation = 20, common_allocation = 80 where id = $1`,
			[sheetId],
		);
		// 本人は評価・集計・ランクを書けず、提出より先の状態にもできない
		for (const change of [
			"total_evaluation_score = 100",
			"first_overall_comment = 'x'",
			"first_rank = 'S'",
			"status = 'finalized'",
			"status = 'first_evaluated'",
			"employee_id = 5",
			"primary_evaluator_id = 4",
		]) {
			await expect(
				db.query(`update public.evaluation_sheets set ${change} where id = $1`, [sheetId]),
				change,
			).rejects.toMatchObject(DENIED);
		}
		await expect(
			db.query("update public.milestones set first_score = 4 where id = $1", [goalIds[0]]),
		).rejects.toMatchObject(DENIED);
		await expect(
			db.query(
				"insert into public.milestones (sheet_id, goal_number, first_score) values ($1, 3, 4)",
				[sheetId],
			),
		).rejects.toMatchObject(DENIED);
		await expect(saveFirst(sheetId, 1, 4)).rejects.toMatchObject(DENIED);

		for (const evaluator of [2, 3]) {
			await actAs(db, evaluator);
			expect(await count("milestones")).toBe(0);
			await expect(
				db.query("update public.milestones set first_score = 4 where id = $1 returning id", [
					goalIds[0],
				]),
			).resolves.toMatchObject({ rows: [] });
		}
		await actAs(db, 5);
		expect(await count("evaluation_sheets")).toBe(0);
		expect(await count("milestones")).toBe(0);
	});

	it("moves to the primary evaluation when the subject submits, and back while it is not confirmed", async () => {
		await actAs(db, 2);
		await expect(setStatus(sheetId, "submitted")).rejects.toMatchObject(DENIED);
		await actAs(db, 4);
		expect((await setStatus(sheetId, "submitted")).rows).toHaveLength(1);
		expect((await setStatus(sheetId, "draft")).rows).toHaveLength(1);
		expect(
			await rows("delete from public.milestones where id = $1 returning id", [goalIds[1]]),
		).toHaveLength(1);
		goalIds[1] = (await saveGoal(sheetId, 2))[0].id;
		await setStatus(sheetId, "submitted");
		// 提出後は、本人も目標を書き換えられない
		expect(
			await rows("update public.milestones set challenge_goal = 'x' where id = $1 returning id", [
				goalIds[0],
			]),
		).toEqual([]);
		expect(
			await rows("delete from public.milestones where id = $1 returning id", [goalIds[0]]),
		).toEqual([]);
	});

	it("lets only the primary evaluator enter and confirm the primary evaluation", async () => {
		await actAs(db, 3);
		expect(await count("milestones")).toBe(2);
		await expect(saveSecond(sheetId, 1, 4)).rejects.toMatchObject(DENIED);
		expect(
			await rows("update public.milestones set second_score = 4 where id = $1 returning id", [
				goalIds[0],
			]),
		).toEqual([]);

		await actAs(db, 2);
		await db.query("update public.milestones set first_score = 3 where sheet_id = $1", [sheetId]);
		await expect(
			db.query("update public.milestones set second_score = 4 where id = $1", [goalIds[0]]),
		).rejects.toMatchObject(DENIED);
		await expect(
			db.query("update public.milestones set challenge_goal = 'x' where id = $1", [goalIds[0]]),
		).rejects.toMatchObject(DENIED);
		await saveFirst(sheetId, 1, 4);
		await saveFirst(sheetId, 2, 4);
		await expect(saveSecond(sheetId, 1, 4)).rejects.toMatchObject(DENIED);
		await db.query(
			"update public.evaluation_sheets set first_overall_comment = '一次総評', objectives_first_total_score = 6 where id = $1",
			[sheetId],
		);
		await expect(
			db.query("update public.evaluation_sheets set second_overall_comment = 'x' where id = $1", [
				sheetId,
			]),
		).rejects.toMatchObject(DENIED);

		// 本人には、確定するまで共通評価が見えない
		await actAs(db, 4);
		expect(await count("common_evaluation_results")).toBe(0);

		await actAs(db, 2);
		const first = rank(score(3, 4)).toDisplayText();
		await expect(setStatus(sheetId, "finalized")).rejects.toMatchObject(DENIED);
		await expect(setStatus(sheetId, "first_evaluated", ", first_rank = 'D'")).rejects.toMatchObject(
			{
				code: "23514",
			},
		);
		expect(
			(await setStatus(sheetId, "first_evaluated", `, first_rank = '${first}'`)).rows,
		).toHaveLength(1);
		// 確定した一次評価は、一次評価者も変えられない
		expect(
			await rows("update public.milestones set first_score = 4 where id = $1 returning id", [
				goalIds[0],
			]),
		).toEqual([]);
		await expect(saveFirst(sheetId, 1, 1)).rejects.toMatchObject(DENIED);
		await expect(
			db.query("update public.evaluation_sheets set first_overall_comment = 'x' where id = $1", [
				sheetId,
			]),
		).rejects.toMatchObject(DENIED);
		await actAs(db, 4);
		await expect(setStatus(sheetId, "draft")).rejects.toMatchObject(DENIED);
	});

	it("lets only the final evaluator finalize, with the score and rank the scores give", async () => {
		await actAs(db, 2);
		await expect(setStatus(sheetId, "finalized")).rejects.toMatchObject(DENIED);
		await actAs(db, 3);
		await db.query("update public.milestones set second_score = 2 where sheet_id = $1", [sheetId]);
		await saveSecond(sheetId, 1, 3);
		await saveSecond(sheetId, 2, 3);
		// 二次評価者は、一次評価を書き換えられない
		await expect(
			db.query("update public.common_evaluation_results set first_score = 1 where sheet_id = $1", [
				sheetId,
			]),
		).rejects.toMatchObject(DENIED);
		const total = score(2, 3);
		const final = rank(total);
		const finalize = (stored: number, letter: string, level: string) =>
			db
				.query(
					"update public.evaluation_sheets set total_evaluation_score = $2, objective_allocation = 20, common_allocation = 80 where id = $1",
					[sheetId, stored],
				)
				.then(() =>
					setStatus(
						sheetId,
						"finalized",
						`, final_rank_letter = '${letter}', final_rank_level = '${level}'`,
					),
				);
		await expect(finalize(100, "S", "none")).rejects.toMatchObject({ code: "23514" });
		await expect(finalize(total, "S", "none")).rejects.toMatchObject({ code: "23514" });
		expect((await finalize(total, final.letter, final.level)).rows).toHaveLength(1);

		// 確定したシートは誰も変えられない
		for (const person of [2, 3, 4]) {
			await actAs(db, person);
			await expect(
				db.query("update public.evaluation_sheets set second_overall_comment = 'x' where id = $1", [
					sheetId,
				]),
				String(person),
			).rejects.toMatchObject(DENIED);
			expect(
				await rows(
					"update public.milestones set second_score = 4 where sheet_id = $1 returning id",
					[sheetId],
				),
			).toEqual([]);
			// 確定後は、本人も帳票に載る共通評価を読める
			expect(await count("common_evaluation_results")).toBe(2);
		}
		await actAs(db, 5);
		expect(await count("common_evaluation_results")).toBe(0);
		// クライアントの変更で、更新日時が進む
		await actAs(db, 4);
		expect(
			await rows(
				"select updated_at > created_at as touched from public.evaluation_sheets where id = $1",
				[sheetId],
			),
		).toEqual([{ touched: true }]);
	});

	it("lets the primary evaluator finalize directly when the sheet has no secondary evaluator", async () => {
		await actAs(db, 6);
		const id = await createSheet(6);
		await saveGoal(id, 1);
		await setStatus(id, "submitted");
		await actAs(db, 2);
		await db.query("update public.milestones set first_score = 4 where sheet_id = $1", [id]);
		await saveFirst(id, 1, 4);
		await saveFirst(id, 2, 4);
		await expect(setStatus(id, "first_evaluated", ", first_rank = 'S'")).rejects.toMatchObject(
			DENIED,
		);
		await db.query(
			"update public.evaluation_sheets set total_evaluation_score = 100, objective_allocation = 20, common_allocation = 80 where id = $1",
			[id],
		);
		expect(
			(
				await setStatus(
					id,
					"finalized",
					", first_rank = 'S', final_rank_letter = 'S', final_rank_level = 'none'",
				)
			).rows,
		).toHaveLength(1);
	});

	it("still carries a new evaluator over to an open sheet when the employee master changes", async () => {
		await actAs(db, 5);
		const id = await createSheet(5);
		await actAs(db, 1);
		await db.query("update public.employees set primary_evaluator_id = 3 where id = 5");
		await actAs(db, 3);
		expect(
			await rows("select primary_evaluator_id from public.evaluation_sheets where id = $1", [id]),
		).toEqual([{ primary_evaluator_id: 3 }]);
	});
});

it("calculates the evaluation score exactly as the app does", async () => {
	await db.exec("reset role");
	// 実施中の期間のシートを、1件ずつ乱数の点数で埋めて突き合わせる
	const sheetId = (
		await rows<{ id: number }>(
			"insert into public.evaluation_sheets (period_id, employee_id, status) values (1, 7, 'submitted') returning id",
		)
	)[0].id;
	await db.exec(`
		update public.evaluation_sheets set primary_evaluator_id = 2, secondary_evaluator_id = 3 where id = ${sheetId};
		insert into public.common_evaluation_results (sheet_id, item_id) values (${sheetId}, 1), (${sheetId}, 2);
	`);
	let seed = 20261012;
	const random = (max: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % (max + 1);
	};
	for (let round = 0; round < 60; round++) {
		const goals = Array.from({ length: 1 + random(3) }, () => random(4));
		const common = [random(4), random(4)];
		const objective = random(100);
		await db.exec("reset role");
		await db.exec(`
			delete from public.milestones where sheet_id = ${sheetId};
			insert into public.milestones (sheet_id, goal_number, first_score)
			select ${sheetId}, n, (array[${goals.join(",")}])[n] from generate_series(1, ${goals.length}) n;
			update public.common_evaluation_results set first_score = ${common[0]} where sheet_id = ${sheetId} and item_id = 1;
			update public.common_evaluation_results set first_score = ${common[1]} where sheet_id = ${sheetId} and item_id = 2;
		`);
		await actAs(db, 2);
		const expected =
			EvaluationAllocation.fromTotal(
				objective,
				goals.reduce((sum, value) => sum + value, 0),
				goals.length * 4,
			) + EvaluationAllocation.fromTotal(100 - objective, common[0] * 2 + common[1] * 3, 20);
		expect(
			await rows(
				"select public.sheet_evaluation_score($1, true, $2, $3) as score, public.evaluation_rank($4) as rank",
				[sheetId, objective, 100 - objective, expected],
			),
			`goals ${goals} common ${common} allocation ${objective}`,
		).toEqual([{ score: expected, rank: rank(expected).toDisplayText() }]);
	}
	// 評価に入っていない人には、点数を返さない
	await actAs(db, 5);
	expect(
		await rows("select public.sheet_evaluation_score($1, true, 20, 80) as score", [sheetId]),
	).toEqual([{ score: null }]);
});
