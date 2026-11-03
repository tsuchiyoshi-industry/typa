import { expect, it, vi } from "vitest";
import type { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { profile } from "../../test/fixtures";
import { SecurityAssuranceController } from "./SecurityAssuranceController";

const setup = (current: EmployeeProfile | null | Promise<never>) => {
	const findCurrentEmployeeProfile = vi.fn(async () => current);
	return {
		controller: new SecurityAssuranceController({ findCurrentEmployeeProfile }),
		findCurrentEmployeeProfile,
	};
};

it("shows the guarantees to an Admin who can use the app", async () => {
	const { controller } = setup(profile("Admin"));
	const view = await controller.open();
	expect(view.gates.length).toBeGreaterThan(0);
});

// メニューに出さないだけでなく、URL を直接開いても中身を渡さない
it.each([
	["a Reviewer", profile("Reviewer")],
	["an Employee", profile("Employee")],
	["a role the app does not know", profile("Owner")],
	["a suspended Admin", Object.assign(profile("Admin"), { enabled: false })],
	["someone with no employee record", null],
])("refuses %s", async (_who, current) => {
	const { controller } = setup(current);
	await expect(controller.open()).rejects.toThrow("Admin のみ");
});

it("refuses when it cannot tell who is signed in", async () => {
	const { controller } = setup(Promise.reject(new Error("offline")));
	await expect(controller.open()).rejects.toThrow();
});
