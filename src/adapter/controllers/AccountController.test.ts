import { describe, expect, it, vi } from "vitest";
import { EmployeeProfile } from "../../domain/entities/EmployeeProfile";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { authRepository, masterRepository, profile } from "../../test/fixtures";
import { AccountController } from "./AccountController";

function setup(domain: Promise<string> = Promise.resolve("example.jp")) {
	const master = masterRepository();
	const auth = authRepository();
	const signIn = { execute: vi.fn() };
	const register = { execute: vi.fn() };
	const controller = new AccountController(signIn as never, register as never, auth, master, {
		findRequiredDomain: () => domain,
	});
	return { controller, master, auth, signIn, register };
}
const executive = new EmployeeProfile(
	5,
	"役員",
	"X5",
	1,
	EmployeeRole.EMPLOYEE,
	"役員",
	null,
	"未設定",
	null,
	"未設定",
	null,
	"未設定",
);

describe("the top bar for the signed-in employee", () => {
	// 基本設計 6.1: 部下の評価は評価者になれる人、設定は Admin。遡及処理と導入処理も Admin だけ
	it.each([
		[
			"an Admin",
			profile("Admin"),
			{ canReview: true, canViewSettings: true, canRunSetup: true, canCorrectClosedSheets: true },
		],
		[
			"a Reviewer",
			profile("Reviewer"),
			{
				canReview: true,
				canViewSettings: false,
				canRunSetup: false,
				canCorrectClosedSheets: false,
			},
		],
		[
			"an Employee",
			profile("Employee"),
			{
				canReview: false,
				canViewSettings: false,
				canRunSetup: false,
				canCorrectClosedSheets: false,
			},
		],
		[
			"an executive without a role",
			executive,
			{
				canReview: true,
				canViewSettings: false,
				canRunSetup: false,
				canCorrectClosedSheets: false,
			},
		],
	])("offers %s only what they may use", async (_label, person, menu) => {
		const { controller, master } = setup();
		master.findCurrentEmployeeProfile.mockResolvedValue(person);
		expect(await controller.currentUser()).toEqual({
			name: person.name,
			employeeNo: person.employeeNo,
			role: person.role.toString(),
			...menu,
		});
	});

	it("knows nobody when the account is not linked to an employee", async () => {
		const { controller, master } = setup();
		master.findCurrentEmployeeProfile.mockResolvedValue(null);
		expect(await controller.currentUser()).toBeNull();
	});
});

describe("signing in and registering", () => {
	it("hands back the status the use case decided, and a failure when it decided nothing", async () => {
		const { controller, signIn, register } = setup();
		signIn.execute.mockImplementation(async (_request, out) =>
			out.present({ status: "signed_in" }),
		);
		expect(await controller.signIn("E1", "pw")).toBe("signed_in");
		expect(signIn.execute).toHaveBeenCalledWith(
			{ employeeNo: "E1", password: "pw" },
			expect.anything(),
		);
		signIn.execute.mockResolvedValue(undefined);
		expect(await controller.signIn("E1", "pw")).toBe("invalid_credentials");

		register.execute.mockImplementation(async (_request, out) => out.present({ status: "linked" }));
		expect(await controller.register({} as never)).toBe("linked");
		register.execute.mockResolvedValue(undefined);
		expect(await controller.register({} as never)).toBe("signup_failed");
	});

	it("names the company mail domain for the code, and nothing when none is set", async () => {
		expect(await setup().controller.requiredEmailSuffix()).toBe("@example.jp");
		expect(await setup(Promise.resolve("")).controller.requiredEmailSuffix()).toBe("");
	});

	it("says whether the verification code could be sent", async () => {
		const { controller, auth } = setup();
		expect(await controller.sendVerificationCode("a@example.jp")).toBe(true);
		auth.sendEmailCode.mockResolvedValue({ error: new Error("rate limited") });
		expect(await controller.sendVerificationCode("a@example.jp")).toBe(false);
	});
});
