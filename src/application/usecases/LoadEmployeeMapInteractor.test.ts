import { describe, expect, it } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import type { EmployeeMapDto } from "../dtos/EmployeeMapDto";
import { LoadEmployeeMapInteractor } from "./LoadEmployeeMapInteractor";

describe("LoadEmployeeMapInteractor", () => {
	it.each(["Reviewer", "Admin"])(
		"%s can read employee relationships without mutations",
		async (role) => {
			const repository = masterRepository();
			repository.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 2));
			const port = output<EmployeeMapDto>();
			await new LoadEmployeeMapInteractor(repository).execute({}, port);
			expect(port.present).toHaveBeenCalledWith({
				currentEmployeeId: 2,
				people: [
					expect.objectContaining({ id: 1, primaryEvaluatorId: 2, secondaryEvaluatorId: 3 }),
				],
			});
			expect(repository.updateEvaluatorByEmployeeNo).not.toHaveBeenCalled();
			expect(repository.updateGradeByEmployeeNo).not.toHaveBeenCalled();
			expect(repository.resetRegistrationByEmployeeNo).not.toHaveBeenCalled();
		},
	);
	it.each(["Employee", "unknown", null])("denies %s before loading employee data", async (role) => {
		const repository = masterRepository();
		repository.findCurrentEmployeeProfile.mockResolvedValue(role === null ? null : profile(role));
		const port = output<EmployeeMapDto>();
		await expect(new LoadEmployeeMapInteractor(repository).execute({}, port)).rejects.toThrow(
			"Reviewer・Admin",
		);
		expect(repository.findAllEmployeeProfiles).not.toHaveBeenCalled();
		expect(port.present).not.toHaveBeenCalled();
	});
	it("does not present partial data when the repository fails", async () => {
		const repository = masterRepository();
		repository.findAllEmployeeProfiles.mockRejectedValue(new Error("offline"));
		const port = output<EmployeeMapDto>();
		await expect(new LoadEmployeeMapInteractor(repository).execute({}, port)).rejects.toThrow(
			"offline",
		);
		expect(port.present).not.toHaveBeenCalled();
	});
});
