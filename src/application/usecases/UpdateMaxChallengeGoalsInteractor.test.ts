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

it.each([
	["Admin", 5, true],
	["Admin", 0, false],
	["Admin", 11, false],
	["Admin", 2.5, false],
	["Reviewer", 5, false],
])("%s setting the goal limit to %s saves: %s", async (role, max, saves) => {
	const repository = settings();
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 9));
	const out = output<never>();
	await new UpdateMaxChallengeGoalsInteractor(repository, employees).execute({ max }, out);
	expect(repository.saveMaxChallengeGoals).toHaveBeenCalledTimes(saves ? 1 : 0);
	expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: saves }));
});
