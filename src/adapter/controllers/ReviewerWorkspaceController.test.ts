import { expect, it, vi } from "vitest";
import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { period, profile } from "../../test/fixtures";
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
	await expect(controller.currentPeriod()).rejects.toBeInstanceOf(ReviewerOnlyError);
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
	await expect(controller.currentPeriod()).resolves.toBeNull();
	await controller.load(10);
	expect(repository.load).toHaveBeenCalledWith(10);
});

const closed = (id: number, startDate: string, endDate: string) =>
	EvaluationPeriod.restore({
		id,
		termName: `締め済み${id}`,
		startDate,
		endDate,
		isActive: false,
		isClosed: true,
	});

it("focuses on the period in progress, whatever else exists or was opened before", async () => {
	const { controller, periods } = setup(profile("Reviewer"));
	periods.findDistinctPeriods.mockResolvedValue([
		closed(8, "2025-04-01", "2025-09-30"),
		period(true),
		closed(11, "2026-10-01", "2027-03-31"),
	]);
	expect((await controller.currentPeriod())?.id).toBe(10);
});

it("has nothing to focus on between closing one period and starting the next", async () => {
	const { controller, periods } = setup(profile("Reviewer"));
	periods.findDistinctPeriods.mockResolvedValue([closed(8, "2025-04-01", "2025-09-30")]);
	await expect(controller.currentPeriod()).resolves.toBeNull();
});
