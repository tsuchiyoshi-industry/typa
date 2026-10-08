import { describe, expect, it } from "vitest";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { masterRepository, output, profile } from "../../test/fixtures";
import type { EmployeeMasterDto } from "../dtos/EmployeeMasterDto";
import { LoadEmployeeMasterInteractor } from "./LoadEmployeeMasterInteractor";
import { UpdateEmployeeRoleInteractor } from "./UpdateEmployeeRoleInteractor";

// 1: Employee, 2: Reviewer, 9: Admin(操作する人), 8: もう一人の Admin
function setup(current: ReturnType<typeof profile> | null = profile("Admin", 9), admins = [9]) {
	const repository = masterRepository();
	repository.findCurrentEmployeeProfile.mockResolvedValue(current);
	repository.findAllEmployeeProfiles.mockResolvedValue([
		profile("Employee", 1),
		profile("Reviewer", 2),
		...admins.map((id) => profile("Admin", id)),
	]);
	return { repository, out: output<{ success: boolean; message: string }>() };
}

describe("changing TYPA roles", () => {
	it.each([profile("Reviewer", 2), profile("Employee", 1), null])(
		"only Admin can change a role (%#)",
		async (current) => {
			const { repository, out } = setup(current);
			await new UpdateEmployeeRoleInteractor(repository).execute(
				{ targetEmployeeNo: "TEST001", roleName: "Admin" },
				out,
			);
			expect(repository.updateRoleByEmployeeNo).not.toHaveBeenCalled();
			expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
		},
	);
	it("lets an Admin change another employee's role", async () => {
		const { repository, out } = setup();
		await new UpdateEmployeeRoleInteractor(repository).execute(
			{ targetEmployeeNo: " TEST001 ", roleName: "Reviewer" },
			out,
		);
		expect(repository.updateRoleByEmployeeNo).toHaveBeenCalledWith(
			"TEST001",
			EmployeeRole.REVIEWER,
		);
		expect(out.present).toHaveBeenCalledWith({
			success: true,
			message: "テスト1さんの権限を Reviewer に変更しました。",
		});
	});
	it.each([
		{ targetEmployeeNo: "TEST001", roleName: "Owner" },
		{ targetEmployeeNo: "TEST001", roleName: "" },
		{ targetEmployeeNo: "NOBODY", roleName: "Reviewer" },
	])("rejects an unknown role or employee %j before any write", async (request) => {
		const { repository, out } = setup();
		await new UpdateEmployeeRoleInteractor(repository).execute(request, out);
		expect(repository.updateRoleByEmployeeNo).not.toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	});
	it("never leaves the system without an Admin", async () => {
		const only = setup();
		await new UpdateEmployeeRoleInteractor(only.repository).execute(
			{ targetEmployeeNo: "TEST009", roleName: "Reviewer" },
			only.out,
		);
		expect(only.repository.updateRoleByEmployeeNo).not.toHaveBeenCalled();
		expect(only.out.present).toHaveBeenCalledWith({
			success: false,
			message: expect.stringContaining("Admin が0名になるため変更できません"),
		});

		// もう一人 Admin がいれば、自分を外せる。Admin のままにする変更は常にできる
		const two = setup(profile("Admin", 9), [9, 8]);
		await new UpdateEmployeeRoleInteractor(two.repository).execute(
			{ targetEmployeeNo: "TEST009", roleName: "Employee" },
			two.out,
		);
		expect(two.repository.updateRoleByEmployeeNo).toHaveBeenCalledWith(
			"TEST009",
			EmployeeRole.EMPLOYEE,
		);
	});
	it("reports a failed save, such as one the database refused", async () => {
		const { repository, out } = setup();
		repository.updateRoleByEmployeeNo.mockResolvedValue(false);
		await new UpdateEmployeeRoleInteractor(repository).execute(
			{ targetEmployeeNo: "TEST001", roleName: "Admin" },
			out,
		);
		expect(out.present).toHaveBeenCalledWith({
			success: false,
			message: "権限の変更に失敗しました。",
		});
	});
});

describe("who can see roles", () => {
	it.each([
		["Admin", true],
		["Reviewer", false],
	] as const)("%s sees other people's roles in the master: %s", async (role, visible) => {
		const { repository } = setup(profile(role, role === "Admin" ? 9 : 2));
		const out = output<EmployeeMasterDto>();
		await new LoadEmployeeMasterInteractor(repository).execute({}, out);
		const dto = out.present.mock.calls[0][0];
		expect(dto.canEditRoles).toBe(visible);
		expect(dto.relations.map((relation) => relation.roleName)).toEqual(
			visible ? ["Employee", "Reviewer", "Admin"] : [null, null, null],
		);
		// 自分の権限は誰でも分かる
		expect(dto.currentEmployee?.roleName).toBe(role);
	});
});
