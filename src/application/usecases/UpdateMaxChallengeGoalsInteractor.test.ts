import { expect, it, vi } from "vitest";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { masterRepository, output, profile } from "../../test/fixtures";
import { UpdateMaxChallengeGoalsInteractor } from "./UpdateMaxChallengeGoalsInteractor";

const settings = () => ({
	findAllocation: vi.fn().mockResolvedValue(EvaluationAllocation.DEFAULT),
	saveAllocation: vi.fn().mockResolvedValue(true),
	findMaxChallengeGoals: vi.fn().mockResolvedValue(4),
	saveMaxChallengeGoals: vi.fn().mockResolvedValue(true),
});
const run = async (role: string | null, max: number, saved = true) => {
	const repository = settings();
	repository.saveMaxChallengeGoals.mockResolvedValue(saved);
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(role ? profile(role, 9) : null);
	const out = output<{ success: boolean; message: string }>();
	await new UpdateMaxChallengeGoalsInteractor(repository, employees).execute({ max }, out);
	return { repository, presented: out.present.mock.calls[0]?.[0] };
};

// 上限は 1〜10 の整数(DB の制約と同じ)。変えられるのは Admin だけ
it.each(
	["Admin", "Reviewer", "Employee", null].flatMap((role) =>
		[0, 1, 10, 11, 2.5, Number.NaN].map((max) => [role, max] as const),
	),
)("%s setting the goal limit to %s", async (role, max) => {
	const saves = role === "Admin" && (max === 1 || max === 10);
	const { repository, presented } = await run(role, max);
	expect(repository.saveMaxChallengeGoals).toHaveBeenCalledTimes(saves ? 1 : 0);
	expect(presented).toEqual({
		success: saves,
		message: saves
			? `チャレンジ目標の上限を ${max} 件にしました。`
			: Number.isInteger(max) && max >= 1 && max <= 10
				? "設定を変更できるのは Admin のみです。"
				: "目標の数の上限は 1〜10 の整数で入力してください。",
	});
});

it("reports a limit the database refused to save", async () => {
	const { presented } = await run("Admin", 5, false);
	expect(presented).toEqual({
		success: false,
		message: "チャレンジ目標の上限を保存できませんでした。",
	});
});
