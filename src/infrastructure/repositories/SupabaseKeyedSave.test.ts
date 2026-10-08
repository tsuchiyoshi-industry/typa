import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from } }));

import { SupabaseCommonEvaluationRepository } from "./SupabaseCommonEvaluationRepository";
import { SupabaseMilestoneRepository } from "./SupabaseMilestoneRepository";

const commonUpsert = vi.fn();
const milestoneUpsert = vi.fn();
const single = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	commonUpsert.mockResolvedValue({ error: null });
	milestoneUpsert.mockReturnValue({ select: () => ({ single }) });
	db.from.mockImplementation((table: string) => ({
		upsert: table === "milestones" ? milestoneUpsert : commonUpsert,
	}));
});

const result = { id: 21, itemId: 31, firstComment: "根拠", firstScore: 3, secondScore: 4 };
const byItem = { onConflict: "sheet_id,item_id" };

it("saves a common evaluation result by its sheet and item, writing only the evaluator's own columns", async () => {
	const repository = new SupabaseCommonEvaluationRepository();
	await repository.upsertResults(100, [result], true, false);
	expect(commonUpsert).toHaveBeenLastCalledWith(
		{ sheet_id: 100, item_id: 31, first_score: 3, first_comment: "根拠" },
		byItem,
	);
	await repository.upsertResults(100, [result], false, true);
	expect(commonUpsert).toHaveBeenLastCalledWith(
		{ sheet_id: 100, item_id: 31, second_score: 4 },
		byItem,
	);
	// 編集できる列がなければ、何も送らない
	await repository.upsertResults(100, [result], false, false);
	expect(commonUpsert).toHaveBeenCalledTimes(2);
	expect(db.from).toHaveBeenCalledWith("common_evaluation_results");
});

it("propagates a refused common evaluation save", async () => {
	commonUpsert.mockResolvedValue({ error: new Error("締められた評価期間") });
	await expect(
		new SupabaseCommonEvaluationRepository().upsertResults(100, [result], true, false),
	).rejects.toThrow("締められた評価期間");
});

it("saves a goal by its sheet and goal number", async () => {
	single.mockResolvedValue({
		data: {
			id: 12,
			sheet_id: 100,
			goal_number: 2,
			challenge_goal: "目標",
			midterm_goal: "中間",
			achievement: "達成",
			first_score: null,
			second_score: null,
		},
		error: null,
	});
	const saved = await new SupabaseMilestoneRepository().upsertText(100, 2, "目標", "中間", "達成");
	expect(milestoneUpsert).toHaveBeenCalledExactlyOnceWith(
		{
			sheet_id: 100,
			goal_number: 2,
			challenge_goal: "目標",
			midterm_goal: "中間",
			achievement: "達成",
		},
		{ onConflict: "sheet_id,goal_number" },
	);
	expect(saved).toMatchObject({ id: 12, sheetId: 100, goalNumber: 2, challengeGoal: "目標" });

	single.mockResolvedValue({ data: null, error: new Error("write denied") });
	await expect(
		new SupabaseMilestoneRepository().upsertText(100, 2, "目標", "中間", "達成"),
	).rejects.toThrow("write denied");
});
