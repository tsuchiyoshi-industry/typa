import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;

const goal = async (viewer: number) => {
	await actAs(db, viewer);
	const { rows } = await db.query<{
		sheet: { objectives: { firstScore: number; secondScore: number }[] };
	}>("select public.get_sheet(500) as sheet");
	return rows[0].sheet.objectives[0];
};
const forceStatus = async (status: string) => {
	await db.exec("reset role");
	await db.exec(`
		alter table public.evaluation_sheets disable trigger user;
		update public.evaluation_sheets set status = '${status}' where id = 500;
		alter table public.evaluation_sheets enable trigger user;
	`);
};

// シート 500: 本人 4・一次評価者 2・二次評価者 3。目標の一次評価は 3 点、二次評価は 2 点
beforeAll(async () => {
	db = await createProdLikeDb();
	await db.exec(`
		alter table public.evaluation_sheets disable trigger user;
		alter table public.milestones disable trigger user;
		insert into public.evaluation_sheets (id, period_id, employee_id, primary_evaluator_id, secondary_evaluator_id, status)
			values (500, 1, 4, 2, 3, 'submitted');
		insert into public.milestones (sheet_id, goal_number, challenge_goal, first_score, second_score) values (500, 1, '目標', 3, 2);
		alter table public.evaluation_sheets enable trigger user;
		alter table public.milestones enable trigger user;
	`);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

describe("目標の点数", () => {
	it.each(["submitted", "first_evaluated"])(
		"%s の間は、評価者が保存しただけの点数を本人に返さない",
		async (status) => {
			await forceStatus(status);
			expect(await goal(4)).toMatchObject({ firstScore: 0, secondScore: 0 });
			expect(await goal(2)).toMatchObject({ firstScore: 3, secondScore: 0 });
			expect(await goal(3)).toMatchObject({ firstScore: 3, secondScore: 2 });
		},
	);

	it("確定したら本人にも返す", async () => {
		await forceStatus("finalized");
		expect(await goal(4)).toMatchObject({ firstScore: 3, secondScore: 2 });
	});

	it("一次評価の点数は、テーブルから直接は読めない", async () => {
		await forceStatus("submitted");
		await actAs(db, 4);
		await expect(
			db.query("select first_score from public.milestones where sheet_id = 500"),
		).rejects.toMatchObject({ code: "42501" });
		// 目標の文言は今までどおり読める
		const { rows } = await db.query(
			"select challenge_goal from public.milestones where sheet_id = 500",
		);
		expect(rows).toEqual([{ challenge_goal: "目標" }]);
	});
});
