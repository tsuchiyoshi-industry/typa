import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
	const single = vi.fn();
	const select = vi.fn(() => ({ single }));
	const eq = vi.fn(() => ({ select }));
	const update = vi.fn(() => ({ eq }));
	const remove = vi.fn(() => ({ eq }));
	const from = vi.fn(() => ({ update, delete: remove }));
	const rpc = vi.fn();
	return { from, update, remove, eq, select, single, rpc };
});
vi.mock("../db/supabase", () => ({ supabase: { from: db.from, rpc: db.rpc } }));

import { SupabaseMilestoneRepository } from "./SupabaseMilestoneRepository";

beforeEach(() => {
	vi.clearAllMocks();
	db.single.mockResolvedValue({ data: { id: 11 }, error: null });
});

it("writes only the score that was given, and reads back nothing but the id", async () => {
	const repository = new SupabaseMilestoneRepository();
	await repository.updateScore(11, 3);
	expect(db.update).toHaveBeenLastCalledWith({ first_score: 3 });
	await repository.updateScore(11, undefined, 4);
	expect(db.update).toHaveBeenLastCalledWith({ second_score: 4 });
	expect(db.eq).toHaveBeenCalledWith("id", 11);
	// 点数は評価シートを読み直して得る(見せてよい範囲は DB が決める)
	expect(db.select).toHaveBeenCalledWith("id");
});

it.each([
	["updateScore", (repository: SupabaseMilestoneRepository) => repository.updateScore(11, 3)],
	[
		"updateText",
		(repository: SupabaseMilestoneRepository) =>
			repository.updateText(11, "a", [{ description: "task", achievement: "c" }], ""),
	],
	["delete", (repository: SupabaseMilestoneRepository) => repository.delete(11)],
] as const)("fails %s when the database refused the write", async (_name, write) => {
	db.single.mockResolvedValueOnce({ data: null, error: new Error("write denied") });
	await expect(write(new SupabaseMilestoneRepository())).rejects.toThrow("write denied");
	// 権限で拒否された書き込みは、エラーではなく 0 件で返ることがある
	db.single.mockResolvedValueOnce({ data: null, error: null });
	await expect(write(new SupabaseMilestoneRepository())).rejects.toThrow();
});

it("carries a previous goal through the database function and returns where it went", async () => {
	db.rpc.mockResolvedValueOnce({ data: 2, error: null });
	expect(await new SupabaseMilestoneRepository().carryOver(100, 7)).toBe(2);
	expect(db.rpc).toHaveBeenCalledWith("carry_over_goal", { p_sheet_id: 100, p_goal_id: 7 });
});

it.each([
	[
		{ data: null, error: { message: "この目標はすでに引き継いでいます。" } },
		"すでに引き継いでいます",
	],
	[{ data: null, error: null }, "番号を読めませんでした"],
])("fails a carry the database refused or did not answer", async (result, message) => {
	db.rpc.mockResolvedValueOnce(result);
	await expect(new SupabaseMilestoneRepository().carryOver(100, 7)).rejects.toThrow(message);
});
