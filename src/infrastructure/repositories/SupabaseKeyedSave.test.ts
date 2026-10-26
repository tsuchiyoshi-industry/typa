import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: { from: db.from, rpc: db.rpc } }));

import { SupabaseCommonEvaluationRepository } from "./SupabaseCommonEvaluationRepository";
import { SupabaseMilestoneRepository } from "./SupabaseMilestoneRepository";

const milestoneUpsert = vi.fn();
const single = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	db.rpc.mockResolvedValue({ error: null });
	milestoneUpsert.mockReturnValue({ select: () => ({ single }) });
	db.from.mockImplementation(() => ({ upsert: milestoneUpsert }));
});

const results = [
	{ id: 21, itemId: 31, firstComment: "根拠", firstScore: 3, secondScore: 4 },
	{ id: -32, itemId: 32, firstComment: "", firstScore: 2, secondScore: 1 },
];

it("saves every common evaluation result in one request, sending only the evaluator's own columns", async () => {
	const repository = new SupabaseCommonEvaluationRepository();
	await repository.upsertResults(100, results, true, false);
	expect(db.rpc).toHaveBeenLastCalledWith("save_common_evaluation", {
		p_sheet_id: 100,
		p_results: [
			{ itemId: 31, firstScore: 3, firstComment: "根拠" },
			{ itemId: 32, firstScore: 2, firstComment: "" },
		],
	});
	await repository.upsertResults(100, results, false, true);
	expect(db.rpc).toHaveBeenLastCalledWith("save_common_evaluation", {
		p_sheet_id: 100,
		p_results: [
			{ itemId: 31, secondScore: 4 },
			{ itemId: 32, secondScore: 1 },
		],
	});
	// 編集できる列がない・保存する項目がないなら、何も送らない
	await repository.upsertResults(100, results, false, false);
	await repository.upsertResults(100, [], true, false);
	expect(db.rpc).toHaveBeenCalledTimes(2);
	expect(db.from).not.toHaveBeenCalled();
});

it("propagates a refused common evaluation save", async () => {
	db.rpc.mockResolvedValue({ error: new Error("締められた評価期間") });
	await expect(
		new SupabaseCommonEvaluationRepository().upsertResults(100, results, true, false),
	).rejects.toThrow("締められた評価期間");
});

it("saves a goal by its sheet and goal number", async () => {
	single.mockResolvedValue({ data: { id: 12 }, error: null });
	await new SupabaseMilestoneRepository().upsertText(
		100,
		2,
		"目標",
		[{ description: "タスク", achievement: "達成" }],
		"",
	);
	expect(milestoneUpsert).toHaveBeenCalledExactlyOnceWith(
		{
			sheet_id: 100,
			goal_number: 2,
			challenge_goal: "目標",
			period_goals: [{ description: "タスク", achievement: "達成" }],
			achievement: "",
		},
		{ onConflict: "sheet_id,goal_number" },
	);

	single.mockResolvedValue({ data: null, error: new Error("write denied") });
	await expect(
		new SupabaseMilestoneRepository().upsertText(
			100,
			2,
			"目標",
			[{ description: "タスク", achievement: "達成" }],
			"",
		),
	).rejects.toThrow("write denied");
});
