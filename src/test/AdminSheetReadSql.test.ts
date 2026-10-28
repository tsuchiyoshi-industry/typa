import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;

interface Document {
	firstOverallComment: string;
	secondOverallComment: string;
	objectives: { challengeGoal: string; firstScore: number; secondScore: number }[];
	commonResults: { firstScore: number; secondScore: number; firstComment: string }[];
}
const read = async (viewer: number, sheetId = 500) => {
	await actAs(db, viewer);
	const { rows } = await db.query<{ sheet: Document | null }>(
		`select public.get_sheet(${sheetId}) as sheet`,
	);
	return rows[0].sheet;
};
const asOwner = async (sql: string) => {
	await db.exec("reset role");
	await db.exec(`
		alter table public.evaluation_sheets disable trigger user;
		alter table public.employees disable trigger user;
		${sql};
		alter table public.employees enable trigger user;
		alter table public.evaluation_sheets enable trigger user;
	`);
};
const forceStatus = (status: string) =>
	asOwner(`update public.evaluation_sheets set status = '${status}' where id in (500, 501, 502)`);
const snapshot = async () => {
	await db.exec("reset role");
	const { rows } = await db.query<{ value: unknown }>(`
		select jsonb_build_object(
			'sheets', (select jsonb_agg(to_jsonb(s) order by id) from public.evaluation_sheets s),
			'goals', (select jsonb_agg(to_jsonb(g) order by id) from public.milestones g),
			'common', (select jsonb_agg(to_jsonb(c) order by id) from public.common_evaluation_results c)
		) as value`);
	return rows[0].value;
};

// 社員 1 が Admin。シート 500: 本人 4・一次 2・二次 3(Admin は関わらない)。
// シート 501: Admin 1 本人のシート(一次 2・二次 3)。シート 502: 本人 5・一次 Admin 1・二次 3。
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`
		alter table public.evaluation_sheets disable trigger user;
		alter table public.milestones disable trigger user;
		alter table public.common_evaluation_results disable trigger user;
		insert into public.evaluation_sheets
			(id, period_id, employee_id, primary_evaluator_id, secondary_evaluator_id, status, first_overall_comment, second_overall_comment)
		values (500, 1, 4, 2, 3, 'draft', '一次総評', '二次総評'),
		       (501, 1, 1, 2, 3, 'draft', '一次総評', '二次総評'),
		       (502, 1, 5, 1, 3, 'draft', '一次総評', '二次総評');
		insert into public.milestones (sheet_id, goal_number, challenge_goal, first_score, second_score)
		values (500, 1, '本人の目標', 3, 2), (501, 1, 'Admin の目標', 3, 2), (502, 1, '社員5の目標', 3, 2);
		insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
		values (500, 1, 3, 4, '一次コメント'), (501, 1, 3, 4, '一次コメント'), (502, 1, 3, 4, '一次コメント');
		alter table public.common_evaluation_results enable trigger user;
		alter table public.milestones enable trigger user;
		alter table public.evaluation_sheets enable trigger user;
	`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

describe("Admin は関わらないシートを get_sheet で読める", () => {
	it.each(["draft", "goals_submitted", "submitted", "first_evaluated", "finalized"])(
		"%s でも、目標・一次・二次の評価と総評をすべて返す",
		async (status) => {
			await forceStatus(status);
			expect(await read(1)).toMatchObject({
				firstOverallComment: "一次総評",
				secondOverallComment: "二次総評",
				objectives: [{ challengeGoal: "本人の目標", firstScore: 3, secondScore: 2 }],
				commonResults: [{ firstScore: 3, secondScore: 4, firstComment: "一次コメント" }],
			});
		},
	);

	it("Admin 以外の関わらない社員(Employee・Reviewer)と、紐付かないアカウントには返さない", async () => {
		await forceStatus("finalized");
		expect(await read(5)).toBeNull();
		await asOwner("update public.employees set role_id = 2 where id = 5");
		expect(await read(5)).toBeNull();
		await asOwner("update public.employees set role_id = 1 where id = 5");
		expect(await read(99)).toBeNull();
		await expect(read(0)).rejects.toMatchObject({ code: "42501" });
	});

	it("利用停止中の Admin には返さない", async () => {
		await forceStatus("finalized");
		await asOwner("update public.employees set is_enabled = false where id = 1");
		try {
			expect(await read(1)).toBeNull();
		} finally {
			await asOwner("update public.employees set is_enabled = true where id = 1");
		}
	});

	it("自分が本人のシートは本人として返す(確定前の点数と総評は伏せる)", async () => {
		await forceStatus("first_evaluated");
		expect(await read(1, 501)).toMatchObject({
			firstOverallComment: "",
			secondOverallComment: "",
			objectives: [{ challengeGoal: "Admin の目標", firstScore: 0, secondScore: 0 }],
		});
	});

	it("自分が一次評価者のシートは一次評価者として返す(二次評価は伏せ、下書きの中身も返さない)", async () => {
		await forceStatus("first_evaluated");
		expect(await read(1, 502)).toMatchObject({
			secondOverallComment: "",
			objectives: [{ firstScore: 3, secondScore: 0 }],
		});
		await forceStatus("draft");
		expect((await read(1, 502))?.objectives).toEqual([]);
	});
});

describe("読めるようになっても、Admin はシートを変えられない", () => {
	it("状態の遷移・共通評価の保存・総評の保存・表の直接更新は、どれも何も変えない", async () => {
		await forceStatus("first_evaluated");
		const before = await snapshot();
		await actAs(db, 1);
		await expect(
			db.query("select public.transition_evaluation_sheet(500, 'finalized')"),
		).rejects.toThrow();
		await actAs(db, 1);
		await expect(
			db.query(
				`select public.save_common_evaluation(500, '[{"itemId": 1, "secondScore": 1}]'::jsonb)`,
			),
		).rejects.toMatchObject({ code: "42501" });
		// 総評はアプリが表を直接更新して保存する
		for (const sql of [
			"update public.evaluation_sheets set second_overall_comment = 'x' where id = 500",
			"update public.milestones set challenge_goal = 'x' where sheet_id = 500",
			"delete from public.milestones where sheet_id = 500",
		]) {
			await actAs(db, 1);
			await db.query(sql).catch(() => undefined);
		}
		expect(await snapshot()).toEqual(before);
	});

	it("テーブルの行ポリシーは広げない(読めるのは get_sheet を通したときだけ)", async () => {
		await forceStatus("finalized");
		await actAs(db, 1);
		const { rows } = await db.query("select id from public.evaluation_sheets where id = 500");
		expect(rows).toEqual([]);
	});
});
