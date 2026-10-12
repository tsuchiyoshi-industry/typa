import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, applyMigrations, createProdLikeDb, uid } from "./prodLikeDb";

const DENIED = { code: "42501" };
let db: PGlite;

interface SheetJson {
	status: string;
	gradeName: string;
	subject: { id: number; name: string };
	primaryEvaluatorName: string;
	secondaryEvaluatorName: string | null;
	period: { isActive: boolean };
	firstOverallComment: string;
	secondOverallComment: string;
	firstRank: string | null;
	finalRankLetter: string | null;
	stored: Record<string, number | null>;
	objectives: { goalNumber: number; firstScore: number; secondScore: number }[];
	commonResults: {
		id: number | null;
		itemId: number;
		weight: number;
		firstScore: number;
		secondScore: number;
		firstComment: string;
	}[];
	allocation: { objective: number; common: number };
	maxChallengeGoals: number;
}
const sheet = async (viewer: number, id = 500) => {
	await actAs(db, viewer);
	return (await db.query<{ sheet: SheetJson | null }>("select public.get_sheet($1) as sheet", [id]))
		.rows[0].sheet;
};
/** 評価の中身は問わず、シート 500 の状態だけを変える。 */
const forceStatus = async (status: string) => {
	await db.exec("reset role");
	await db.exec(`
		alter table public.evaluation_sheets disable trigger user;
		update public.evaluation_sheets set status = '${status}' where id = 500;
		alter table public.evaluation_sheets enable trigger user;
	`);
};

// シート 500: 本人 4・一次評価者 2・二次評価者 3。一次評価は 3 点、二次評価は 2 点で、総評も入っている
beforeAll(async () => {
	db = await createProdLikeDb("202610120003_z");
	await db.exec(`
		insert into public.evaluation_sheets (id, period_id, employee_id, status, first_overall_comment, second_overall_comment,
			first_rank, final_rank_letter, final_rank_level, total_evaluation_score, objective_allocation, common_allocation)
		values (500, 1, 4, 'draft', '一次総評', '二次総評', 'B', 'B', 'minus', 50, 30, 70);
		insert into public.milestones (sheet_id, goal_number, challenge_goal, first_score, second_score) values (500, 1, '目標', 3, 2);
		insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment) values (500, 1, 3, 2, '所見');
	`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

describe("get_sheet", () => {
	it("returns nothing to people who are not on the sheet", async () => {
		await forceStatus("finalized");
		expect(await sheet(5)).toBeNull();
		expect(await sheet(1)).toBeNull();
		expect(await sheet(99)).toBeNull();
		expect(await sheet(4, 12345)).toBeNull();
		await actAs(db, 0);
		await expect(db.query("select public.get_sheet(500)")).rejects.toMatchObject(DENIED);
	});

	it("gives the whole sheet in one call, with one entry per item of the grade", async () => {
		await forceStatus("submitted");
		const result = await sheet(3);
		expect(result).toMatchObject({
			status: "submitted",
			gradeName: "一般1級",
			subject: { id: 4, name: "社員4" },
			primaryEvaluatorName: "社員2",
			secondaryEvaluatorName: "社員3",
			period: { isActive: true },
			allocation: { objective: 20, common: 80 },
			maxChallengeGoals: 4,
			objectives: [{ goalNumber: 1, firstScore: 3, secondScore: 2 }],
		});
		// 結果が未保存の項目(2)も、0 点の行として返る
		expect(result?.commonResults.map((row) => [row.itemId, row.id === null, row.weight])).toEqual([
			[1, false, 2],
			[2, true, 3],
		]);
	});

	it("hides a draft's content from its evaluators", async () => {
		await forceStatus("draft");
		expect((await sheet(4))?.objectives).toHaveLength(1);
		for (const evaluator of [2, 3]) {
			const result = await sheet(evaluator);
			expect(result?.objectives, String(evaluator)).toEqual([]);
			expect(result?.firstOverallComment).toBe("");
			expect(result?.commonResults[0]).toMatchObject({ firstScore: 0, firstComment: "" });
		}
	});

	it.each(["submitted", "first_evaluated"])(
		"shows each reader only their part while the sheet is %s",
		async (status) => {
			await forceStatus(status);
			// 本人: 目標とその点数は見えるが、共通評価・総評・ランクは見えない
			const subject = await sheet(4);
			expect(subject?.objectives[0]).toMatchObject({ firstScore: 3, secondScore: 2 });
			expect(subject?.commonResults[0]).toMatchObject({
				firstScore: 0,
				secondScore: 0,
				firstComment: "",
			});
			expect([
				subject?.firstOverallComment,
				subject?.secondOverallComment,
				subject?.firstRank,
			]).toEqual(["", "", null]);
			// 一次評価者: 一次評価は見えるが、二次評価は見えない
			const primary = await sheet(2);
			expect(primary?.objectives[0]).toMatchObject({ firstScore: 3, secondScore: 0 });
			expect(primary?.commonResults[0]).toMatchObject({
				firstScore: 3,
				secondScore: 0,
				firstComment: "所見",
			});
			expect([primary?.firstOverallComment, primary?.secondOverallComment]).toEqual([
				"一次総評",
				"",
			]);
			expect(primary?.firstRank).toBe(status === "first_evaluated" ? "B" : null);
			// 二次評価者: すべて見える
			const secondary = await sheet(3);
			expect(secondary?.objectives[0]).toMatchObject({ firstScore: 3, secondScore: 2 });
			expect(secondary?.commonResults[0]).toMatchObject({ firstScore: 3, secondScore: 2 });
			expect(secondary?.secondOverallComment).toBe("二次総評");
			// 確定前は、保存済みの集計・最終ランクを誰にも返さない
			for (const reader of [subject, primary, secondary]) {
				expect([reader?.stored, reader?.finalRankLetter]).toEqual([{}, null]);
			}
		},
	);

	it("gives everyone on a finalized sheet the whole record, with the stored totals", async () => {
		await forceStatus("finalized");
		for (const reader of [4, 2, 3]) {
			const result = await sheet(reader);
			expect(result?.objectives[0], String(reader)).toMatchObject({
				firstScore: 3,
				secondScore: 2,
			});
			expect(result?.commonResults[0]).toMatchObject({
				firstScore: 3,
				secondScore: 2,
				firstComment: "所見",
			});
			expect([result?.firstOverallComment, result?.secondOverallComment]).toEqual([
				"一次総評",
				"二次総評",
			]);
			expect([result?.firstRank, result?.finalRankLetter]).toEqual(["B", "B"]);
			expect(result?.stored).toMatchObject({
				totalEvaluationScore: 50,
				objectiveAllocation: 30,
				commonAllocation: 70,
			});
		}
	});
});

describe("get_sheet_notification", () => {
	const notification = async (actor: number) => {
		await db.exec("reset role; set role service_role");
		return (
			await db.query<{ value: { status: string; recipients: unknown[] } }>(
				"select public.get_sheet_notification(500, $1) as value",
				[uid(actor)],
			)
		).rows[0].value;
	};

	it("tells the next person in line, for the person who moved the sheet there", async () => {
		await forceStatus("submitted");
		expect(await notification(4)).toMatchObject({
			status: "submitted",
			sheetId: 500,
			employeeName: "社員4",
			employeeNo: "E4",
			periodName: "実施中",
			recipients: [{ role: "primary", name: "社員2", email: "person2@example.jp" }],
		});
		await expect(notification(2)).rejects.toMatchObject(DENIED);
		await forceStatus("first_evaluated");
		expect((await notification(2)).recipients).toEqual([
			{ role: "secondary", name: "社員3", email: "person3@example.jp" },
		]);
		await expect(notification(4)).rejects.toMatchObject(DENIED);
		await expect(notification(3)).rejects.toMatchObject(DENIED);
		await forceStatus("finalized");
		expect((await notification(3)).recipients).toEqual([
			{ role: "primary", name: "社員2", email: "person2@example.jp" },
			{ role: "secondary", name: "社員3", email: "person3@example.jp" },
		]);
		await expect(notification(2)).rejects.toMatchObject(DENIED);
		await expect(notification(5)).rejects.toMatchObject(DENIED);
		await forceStatus("draft");
		await expect(notification(4)).rejects.toMatchObject(DENIED);
	});

	it("is not callable by a client", async () => {
		await actAs(db, 3);
		await expect(
			db.query("select public.get_sheet_notification(500, $1)", [uid(3)]),
		).rejects.toMatchObject(DENIED);
	});
});

/** 共通評価の全項目を、一次・二次とも score 点・コメント付きで保存しようとする(どちらが入るかはDBが決める)。 */
const save = (sheetId: number, score: number, items = [1, 2]) =>
	db.query("select public.save_common_evaluation($1, $2::jsonb)", [
		sheetId,
		JSON.stringify(
			items.map((itemId) => ({
				itemId,
				firstScore: score,
				secondScore: score,
				firstComment: "所見",
			})),
		),
	]);

describe("save_common_evaluation", () => {
	const stored = async () => {
		await db.exec("reset role");
		return (
			await db.query(
				"select item_id, first_score, second_score, first_comment from public.common_evaluation_results where sheet_id = 500 order by item_id",
			)
		).rows;
	};

	it("saves only the caller's own stage, and only in that stage", async () => {
		await db.exec("reset role; delete from public.common_evaluation_results where sheet_id = 500");
		await forceStatus("draft");
		for (const person of [4, 2, 3]) {
			await actAs(db, person);
			await expect(save(500, 4), String(person)).rejects.toMatchObject(DENIED);
		}
		await forceStatus("submitted");
		for (const person of [4, 3, 5]) {
			await actAs(db, person);
			await expect(save(500, 4), String(person)).rejects.toMatchObject(DENIED);
		}
		await actAs(db, 2);
		// 等級の項目セットにない項目(99)は保存しない
		await save(500, 3, [1, 2, 99]);
		expect(await stored()).toEqual([
			{ item_id: 1, first_score: 3, second_score: 0, first_comment: "所見" },
			{ item_id: 2, first_score: 3, second_score: 0, first_comment: "所見" },
		]);
		await forceStatus("first_evaluated");
		await actAs(db, 2);
		await expect(save(500, 1)).rejects.toMatchObject(DENIED);
		await actAs(db, 3);
		await save(500, 2);
		expect(await stored()).toEqual([
			{ item_id: 1, first_score: 3, second_score: 2, first_comment: "所見" },
			{ item_id: 2, first_score: 3, second_score: 2, first_comment: "所見" },
		]);
		await forceStatus("finalized");
		await actAs(db, 3);
		await expect(save(500, 4)).rejects.toMatchObject(DENIED);
	});
});

// 配布済みのアプリがすべて 0.9.8 より新しくなった後に当てる締め付け
describe("after 202610120010", () => {
	beforeAll(async () => {
		await applyMigrations(db, (file) => file.startsWith("202610120010"));
		await db.exec("delete from public.evaluation_sheets where id = 500");
	}, 60_000);

	it("no longer hands out the SMTP account or the evaluations in the tables", async () => {
		await actAs(db, 3);
		await expect(db.query("select public.get_notification_smtp_settings()")).rejects.toMatchObject({
			code: "42883",
		});
		for (const table of ["evaluation_sheets", "milestones", "common_evaluation_results"]) {
			await expect(db.query(`select * from public.${table}`), table).rejects.toMatchObject(DENIED);
		}
		await expect(
			db.query("select first_overall_comment from public.evaluation_sheets"),
		).rejects.toMatchObject(DENIED);
		await expect(db.query("select second_score from public.milestones")).rejects.toMatchObject(
			DENIED,
		);
		await expect(
			db.query("update public.common_evaluation_results set second_score = 4"),
		).rejects.toMatchObject(DENIED);
	});

	it("still lets the app list, create, fill, evaluate and finalize a sheet", async () => {
		await actAs(db, 4);
		const sheetId = (
			await db.query<{ id: number }>(
				`insert into public.evaluation_sheets (period_id, employee_id) values (1, 4)
				 on conflict (period_id, employee_id) do update set period_id = excluded.period_id, employee_id = excluded.employee_id
				 returning id`,
			)
		).rows[0].id;
		const goal = await db.query<{ id: number }>(
			`insert into public.milestones (sheet_id, goal_number, challenge_goal, midterm_goal, achievement)
			 values ($1, 1, '目標', '', '')
			 on conflict (sheet_id, goal_number) do update set challenge_goal = excluded.challenge_goal
			 returning id`,
			[sheetId],
		);
		await db.query(
			"update public.milestones set challenge_goal = '書き直し' where id = $1 returning id",
			[goal.rows[0].id],
		);
		await db.query("update public.evaluation_sheets set status = 'submitted' where id = $1", [
			sheetId,
		]);
		expect(
			(
				await db.query(
					"select id, period_id, employee_id, status, total_score, created_at, updated_at from public.evaluation_sheets where employee_id = 4",
				)
			).rows,
		).toHaveLength(1);

		await actAs(db, 2);
		await db.query("update public.milestones set first_score = 4 where id = $1 returning id", [
			goal.rows[0].id,
		]);
		await save(sheetId, 4);
		await db.query(
			"update public.evaluation_sheets set objectives_first_total_score = 4, first_overall_comment = '総評' where id = $1",
			[sheetId],
		);
		await db.query(
			"update public.evaluation_sheets set status = 'first_evaluated', first_rank = 'S' where id = $1",
			[sheetId],
		);

		await actAs(db, 3);
		await db.query("update public.milestones set second_score = 4 where id = $1 returning id", [
			goal.rows[0].id,
		]);
		await save(sheetId, 4);
		await db.query(
			"update public.evaluation_sheets set total_evaluation_score = 100, objective_allocation = 20, common_allocation = 80 where id = $1",
			[sheetId],
		);
		await db.query(
			"update public.evaluation_sheets set status = 'finalized', final_rank_letter = 'S', final_rank_level = 'none' where id = $1",
			[sheetId],
		);
		expect((await sheet(4, sheetId))?.stored).toMatchObject({ totalEvaluationScore: 100 });
	});
});
