import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../../domain/Result";
import { employeeRepository } from "../../test/fixtures";
import { ChallengeEvaluationController } from "./ChallengeEvaluationController";
import { CommonEvaluationController } from "./CommonEvaluationController";

// 目標と共通評価の保存は、どの操作も同じ扱い:
// ログインしていなければ何もしない / 断られたら理由を出す / 例外は本文か既定の文言を出す / できたら true
function controllers(execute = vi.fn().mockResolvedValue(ok(undefined))) {
	const employees = employeeRepository();
	const presentError = vi.fn();
	const carryOver = { execute: vi.fn().mockResolvedValue(ok(undefined)) };
	const previous = { findPreviousGoals: vi.fn().mockResolvedValue(null) };
	const challenge = new ChallengeEvaluationController(
		{ execute } as never,
		{ present: vi.fn() },
		presentError,
		employees,
		previous,
		carryOver,
	);
	const common = new CommonEvaluationController(
		{ execute } as never,
		{
			viewModel: vi.fn(),
			outputPort: { upsert: { present: vi.fn() } },
			presentUpsertError: presentError,
		},
		employees,
	);
	return { challenge, common, employees, presentError, execute, carryOver, previous };
}
type Context = ReturnType<typeof controllers>;

const operations: [string, (context: Context) => Promise<boolean>, string][] = [
	[
		"updating a goal",
		({ challenge }) => challenge.updateText(100, 11, "目標", [], ""),
		"更新に失敗しました",
	],
	[
		"writing a goal by number",
		({ challenge }) => challenge.upsertText(100, 2, "目標", [], ""),
		"更新に失敗しました",
	],
	["deleting a goal", ({ challenge }) => challenge.delete(100, 11), "削除に失敗しました"],
	["scoring a goal", ({ challenge }) => challenge.updateScore(100, 11, 3), "更新に失敗しました"],
	["saving the common evaluation", ({ common }) => common.upsert(100, []), "登録に失敗しました"],
];

describe.each(operations)("%s", (_label, run, fallback) => {
	it("does it for the signed-in employee", async () => {
		const context = controllers();
		expect(await run(context)).toBe(true);
		expect(context.execute).toHaveBeenCalledWith(
			expect.objectContaining({ sheetId: 100, currentEmployeeId: 1 }),
			expect.anything(),
		);
		expect(context.presentError).not.toHaveBeenCalled();
	});

	it("does nothing without a signed-in employee", async () => {
		const context = controllers();
		context.employees.findCurrentEmployeeId.mockResolvedValue({ data: null, error: null });
		expect(await run(context)).toBe(false);
		expect(context.execute).not.toHaveBeenCalled();
		expect(context.presentError).toHaveBeenCalledWith("ログインが必要です。");
	});

	it("says why the sheet refused it", async () => {
		const context = controllers(vi.fn().mockResolvedValue(err({ kind: "periodClosed" })));
		expect(await run(context)).toBe(false);
		expect(context.presentError).toHaveBeenCalledWith(
			expect.stringContaining("この評価期間は締められているため"),
		);
	});

	it.each([
		[new Error("permission denied for table milestones"), "permission denied for table milestones"],
		["not an Error", fallback],
	])("reports a failure on the way (%s) instead of crashing", async (failure, message) => {
		const context = controllers(vi.fn().mockRejectedValue(failure));
		expect(await run(context)).toBe(false);
		expect(context.presentError).toHaveBeenCalledWith(message);
	});
});

describe("goals in particular", () => {
	it("does not write a goal before the sheet exists", async () => {
		const context = controllers();
		expect(await context.challenge.upsertText(0, 1, "目標", [], "")).toBe(false);
		expect(context.execute).not.toHaveBeenCalled();
		expect(context.presentError).toHaveBeenCalledWith(
			"評価シートIDを取得できないため、目標を保存できません。",
		);
	});

	it("carries a previous goal over and says where it went, or why it could not", async () => {
		const context = controllers();
		context.carryOver.execute.mockImplementation(async (_request, out) => {
			out.present({ goalNumber: 3 });
			return ok(undefined);
		});
		expect(await context.challenge.carryOver(100, 7)).toEqual({ goalNumber: 3 });

		context.carryOver.execute.mockResolvedValue(err({ kind: "previousGoalInvalid" }));
		expect(await context.challenge.carryOver(100, 7)).toEqual({ error: "前期の目標が不正です。" });
		context.carryOver.execute.mockRejectedValue("network");
		expect(await context.challenge.carryOver(100, 7)).toEqual({
			error: "前期の目標を引き継げませんでした。",
		});
		// 成功と言いながら行き先を知らせない応答は、失敗として扱う
		context.carryOver.execute.mockResolvedValue(ok(undefined));
		expect(await context.challenge.carryOver(100, 7)).toEqual({
			error: "前期の目標を引き継げませんでした。",
		});
		context.employees.findCurrentEmployeeId.mockResolvedValue({ data: null, error: null });
		expect(await context.challenge.carryOver(100, 7)).toEqual({ error: "ログインが必要です。" });
	});

	it("shows nothing from the previous period when it cannot be read", async () => {
		const context = controllers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		context.previous.findPreviousGoals.mockRejectedValue(new Error("network"));
		expect(await context.challenge.loadPreviousGoals(100)).toBeNull();
	});
});
