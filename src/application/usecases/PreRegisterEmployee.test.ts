import { describe, expect, it } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	PreRegisterEmployeeInteractor,
	type PreRegisterEmployeeRequest,
	type PreRegisterEmployeeResponse,
} from "./PreRegisterEmployeeInteractor";

const request: PreRegisterEmployeeRequest = {
	employeeNo: " ＮＥＷ００１ ",
	name: " 新入 社員 ",
	gradeId: 5,
	careerCourse: "総合職",
	primaryEvaluatorEmployeeNo: "TEST001",
	secondaryEvaluatorEmployeeNo: null,
	noSecondaryEvaluator: true,
};

const run = async (
	input: Partial<PreRegisterEmployeeRequest> = {},
	role: string | null = "Admin",
) => {
	const repo = masterRepository();
	repo.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role, 2));
	// 評価者に選べるのは評価者の権限を持つ人(EmployeeProfile.canBeEvaluator)
	repo.findAllEmployeeProfiles.mockResolvedValue([profile("Reviewer")]);
	const out = output<PreRegisterEmployeeResponse>();
	await new PreRegisterEmployeeInteractor(repo).execute({ ...request, ...input }, out);
	expect(out.present).toHaveBeenCalledOnce();
	return { repo, response: out.present.mock.calls[0][0] };
};

describe("pre-register an employee", () => {
	it("normalizes full-width input and saves it", async () => {
		const { repo, response } = await run();
		expect(repo.preRegisterEmployee).toHaveBeenCalledWith({
			...request,
			employeeNo: "NEW001",
			name: "新入 社員",
		});
		expect(response).toEqual({ success: true, message: expect.stringContaining("NEW001") });
	});

	it.each(["Reviewer", "Employee", null])("denies %s", async (role) => {
		const { repo, response } = await run({}, role);
		expect(response.success).toBe(false);
		expect(repo.preRegisterEmployee).not.toHaveBeenCalled();
	});

	it.each<[string, Partial<PreRegisterEmployeeRequest>]>([
		["an empty employee number", { employeeNo: "  " }],
		["an employee number that cannot be a login ID", { employeeNo: "山田1" }],
		["an employee number with a space", { employeeNo: "NEW 001" }],
		["an empty name", { name: "　" }],
		["an unknown career course", { careerCourse: "総合" }],
		["an unknown grade", { gradeId: 99 }],
		["an employee number taken by someone else", { employeeNo: "TEST001" }],
		["an employee number differing only by case", { employeeNo: "test001" }],
		["an unknown primary evaluator", { primaryEvaluatorEmployeeNo: "NOBODY" }],
		[
			"an unknown secondary evaluator",
			{ secondaryEvaluatorEmployeeNo: "NOBODY", noSecondaryEvaluator: false },
		],
		["a secondary evaluator together with 'none'", { secondaryEvaluatorEmployeeNo: "TEST001" }],
	])("refuses %s without writing", async (_case, input) => {
		const { repo, response } = await run(input);
		expect(response.success).toBe(false);
		expect(response.message).not.toBe("");
		expect(repo.preRegisterEmployee).not.toHaveBeenCalled();
	});

	it("allows no evaluators at all", async () => {
		const { response } = await run({
			primaryEvaluatorEmployeeNo: null,
			secondaryEvaluatorEmployeeNo: null,
			noSecondaryEvaluator: false,
		});
		expect(response.success).toBe(true);
	});

	it("reports a refusal from the database", async () => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
		repo.findAllEmployeeProfiles.mockResolvedValue([profile("Reviewer")]);
		repo.preRegisterEmployee.mockResolvedValue(false);
		const out = output<PreRegisterEmployeeResponse>();
		await new PreRegisterEmployeeInteractor(repo).execute(request, out);
		expect(out.present).toHaveBeenCalledWith({
			success: false,
			message: "仮登録できませんでした。",
		});
	});
});
