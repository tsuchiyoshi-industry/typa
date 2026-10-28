import { expect, it, vi } from "vitest";
import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { profile } from "../../test/fixtures";
import { ReviewerOnlyError, ReviewerWorkspaceController } from "./ReviewerWorkspaceController";

const setup = (actor: EmployeeProfile | null) => {
	const repository = { load: vi.fn().mockResolvedValue([]) };
	const periods = { findDistinctPeriods: vi.fn().mockResolvedValue([]) };
	const employees = { findCurrentEmployeeProfile: vi.fn().mockResolvedValue(actor) };
	const controller = new ReviewerWorkspaceController(
		repository as never,
		periods as never,
		employees,
	);
	return { controller, repository, periods };
};

const withCourse = (base: EmployeeProfile, careerCourse: string, enabled = true) =>
	Object.assign(Object.create(EmployeeProfile.prototype), base, { careerCourse, enabled });

it.each([
	["an Employee", profile("Employee")],
	["a disabled Reviewer", withCourse(profile("Reviewer"), "技術", false)],
	["an unknown user", null],
])("refuses %s before reading anything, even by direct URL", async (_, actor) => {
	const { controller, repository, periods } = setup(actor);
	await expect(controller.loadPeriods()).rejects.toBeInstanceOf(ReviewerOnlyError);
	await expect(controller.load(10)).rejects.toBeInstanceOf(ReviewerOnlyError);
	expect(periods.findDistinctPeriods).not.toHaveBeenCalled();
	expect(repository.load).not.toHaveBeenCalled();
});

it.each([
	["Admin", profile("Admin")],
	["Reviewer", profile("Reviewer")],
	// 役員は権限が Employee でも評価者になる
	["an executive with the Employee role", withCourse(profile("Employee"), "役員")],
])("lets %s read the caseload", async (_, actor) => {
	const { controller, repository } = setup(actor);
	await expect(controller.loadPeriods()).resolves.toEqual([]);
	await controller.load(10);
	expect(repository.load).toHaveBeenCalledWith(10);
});
