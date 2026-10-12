import { expect, it } from "vitest";
import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	LoadEmployeeMasterInteractor,
	type LoadEmployeeMasterResponse,
} from "./LoadEmployeeMasterInteractor";
import {
	UpdateEmployeeKeepSignedInInteractor,
	type UpdateEmployeeKeepSignedInResponse,
} from "./UpdateEmployeeKeepSignedInInteractor";

const change = async (role: string, keepSignedIn: boolean, targetEmployeeNo = "TEST001") => {
	const repository = masterRepository();
	repository.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 9));
	const out = output<UpdateEmployeeKeepSignedInResponse>();
	await new UpdateEmployeeKeepSignedInInteractor(repository).execute(
		{ targetEmployeeNo, keepSignedIn },
		out,
	);
	return { repository, result: out.present.mock.calls[0][0] };
};

it("lets an Admin decide who stays signed in, and says when it takes effect", async () => {
	const kept = await change("Admin", true, " TEST001 ");
	expect(kept.repository.updateKeepSignedInByEmployeeNo).toHaveBeenCalledWith("TEST001", true);
	expect(kept.result).toMatchObject({ success: true });
	expect(kept.result.message).toContain("ログインしたまま");
	const ended = await change("Admin", false);
	expect(ended.repository.updateKeepSignedInByEmployeeNo).toHaveBeenCalledWith("TEST001", false);
	expect(ended.result.message).toContain("ログアウト");
});

it.each(["Reviewer", "Employee"])("does not let a %s change it", async (role) => {
	const { repository, result } = await change(role, true);
	expect(result.success).toBe(false);
	expect(repository.updateKeepSignedInByEmployeeNo).not.toHaveBeenCalled();
});

it("reports a change the database refused, and an empty employee number", async () => {
	const repository = masterRepository();
	repository.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 9));
	repository.updateKeepSignedInByEmployeeNo.mockResolvedValue(null);
	for (const targetEmployeeNo of ["TEST001", " "]) {
		const out = output<UpdateEmployeeKeepSignedInResponse>();
		await new UpdateEmployeeKeepSignedInInteractor(repository).execute(
			{ targetEmployeeNo, keepSignedIn: true },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
	}
	expect(repository.updateKeepSignedInByEmployeeNo).toHaveBeenCalledTimes(1);
});

it("shows who stays signed in to an Admin only", async () => {
	const kept = new EmployeeProfile(
		1,
		"テスト1",
		"TEST001",
		1,
		EmployeeRole.EMPLOYEE,
		"技術",
		5,
		"等級",
		2,
		"一次",
		3,
		"二次",
		false,
		true,
		true,
	);
	const load = async (role: string) => {
		const repository = masterRepository();
		repository.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 9));
		repository.findAllEmployeeProfiles.mockResolvedValue([kept]);
		const out = output<LoadEmployeeMasterResponse>();
		await new LoadEmployeeMasterInteractor(repository).execute({}, out);
		return out.present.mock.calls[0][0].relations[0].keepSignedIn;
	};
	expect(await load("Admin")).toBe(true);
	expect(await load("Reviewer")).toBeNull();
});
