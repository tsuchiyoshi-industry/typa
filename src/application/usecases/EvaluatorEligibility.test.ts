import { describe, expect, it } from "vitest";
import { canBeEvaluator, EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { masterRepository, output, profile } from "../../test/fixtures";
import { PreRegisterEmployeeInteractor } from "./PreRegisterEmployeeInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./UpdateEmployeeEvaluatorInteractor";

const executive = (role: string) =>
	new EmployeeProfile(
		4,
		"役員4",
		"TEST004",
		1,
		EmployeeRole.fromStored(role),
		" 役員 ",
		null,
		"",
		null,
		"",
		null,
		"",
	);

describe("who can be an evaluator", () => {
	it.each([
		["Admin", "総合職", true],
		["Reviewer", "一般職", true],
		["Employee", "役員", true],
		["Employee", "総合職", false],
		["Employee", null, false],
		// 知らない権限は Employee として読む
		["admin", "総合職", false],
	] as const)("%s / %s → %s", (role, course, expected) => {
		expect(canBeEvaluator(EmployeeRole.fromStored(role), course)).toBe(expected);
	});
	it("reads an executive course with stray spaces", () => {
		expect(executive("Employee").canBeEvaluator()).toBe(true);
		expect(profile("Employee").canBeEvaluator()).toBe(false);
	});
});

describe("assigning an evaluator without the right", () => {
	it.each(["primary", "secondary"] as const)(
		"rejects an Employee as %s evaluator",
		async (type) => {
			const repo = masterRepository();
			repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
			repo.findByEmployeeNo
				.mockResolvedValueOnce(profile())
				.mockResolvedValueOnce(profile("Employee", 3));
			const out = output<never>();
			await new UpdateEmployeeEvaluatorInteractor(repo).execute(
				{ targetEmployeeNo: "TEST001", evaluatorEmployeeNo: "TEST003", evaluatorType: type },
				out,
			);
			expect(repo.updateEvaluatorByEmployeeNo).not.toHaveBeenCalled();
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({
					success: false,
					message: expect.stringContaining("テスト3さん"),
				}),
			);
		},
	);
	it("accepts an executive with the Employee role", async () => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
		repo.findByEmployeeNo
			.mockResolvedValueOnce(profile())
			.mockResolvedValueOnce(executive("Employee"));
		const out = output<never>();
		await new UpdateEmployeeEvaluatorInteractor(repo).execute(
			{ targetEmployeeNo: "TEST001", evaluatorEmployeeNo: "TEST004", evaluatorType: "primary" },
			out,
		);
		expect(repo.updateEvaluatorByEmployeeNo).toHaveBeenCalledOnce();
	});
	it.each([
		["primary", { primaryEvaluatorEmployeeNo: "TEST003" }],
		["secondary", { secondaryEvaluatorEmployeeNo: "TEST003", noSecondaryEvaluator: false }],
	] as const)("refuses to pre-register with an Employee as %s evaluator", async (_, evaluators) => {
		const repo = masterRepository();
		repo.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 2));
		repo.findAllEmployeeProfiles.mockResolvedValue([
			profile("Reviewer", 1),
			profile("Employee", 3),
		]);
		const out = output<never>();
		await new PreRegisterEmployeeInteractor(repo).execute(
			{
				employeeNo: "NEW001",
				name: "新入",
				gradeId: 5,
				careerCourse: "総合職",
				primaryEvaluatorEmployeeNo: "TEST001",
				secondaryEvaluatorEmployeeNo: null,
				noSecondaryEvaluator: true,
				...evaluators,
			},
			out,
		);
		expect(repo.preRegisterEmployee).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith({
			success: false,
			message: expect.stringContaining("テスト3さん"),
		});
	});
});
