import { describe, expect, it } from "vitest";
import { authRepository, employeeRepository, output } from "../../test/fixtures";
import {
	RegisterEmployeeAccountInteractor,
	type RegisterEmployeeAccountRequest,
	type RegisterEmployeeAccountResponse,
} from "./RegisterEmployeeAccountInteractor";
import { SignInEmployeeInteractor, type SignInEmployeeResponse } from "./SignInEmployeeInteractor";

describe("sign in with an employee number", () => {
	const signIn = async (auth = authRepository(), employees = employeeRepository()) => {
		const out = output<SignInEmployeeResponse>();
		await new SignInEmployeeInteractor(auth, employees).execute(
			{ employeeNo: "TEST001", password: "Passw0rd" },
			out,
		);
		return { auth, employees, status: out.present.mock.calls[0]?.[0].status };
	};

	it("signs in a linked account", async () => {
		const { auth, employees, status } = await signIn();
		expect(status).toBe("signed_in");
		expect(employees.checkUserLinked).toHaveBeenCalledWith("auth-user");
		expect(auth.signOut).not.toHaveBeenCalled();
	});

	it.each([
		{ userId: null, error: new Error("invalid") },
		{ userId: null, error: null },
	])("rejects wrong credentials without checking the employee link", async (result) => {
		const auth = authRepository();
		auth.signInWithPassword.mockResolvedValue(result);
		const { employees, status } = await signIn(auth);
		expect(status).toBe("invalid_credentials");
		expect(employees.checkUserLinked).not.toHaveBeenCalled();
	});

	it("signs out an account that is not linked to an employee", async () => {
		const employees = employeeRepository();
		employees.checkUserLinked.mockResolvedValue(false);
		const { auth, status } = await signIn(undefined, employees);
		expect(status).toBe("registration_incomplete");
		expect(auth.signOut).toHaveBeenCalledOnce();
	});
});

describe("register an employee account", () => {
	const request: RegisterEmployeeAccountRequest = {
		employeeNo: "TEST001",
		password: "Passw0rd",
		email: "shared@example.com",
		verificationCode: "123456",
	};
	const register = async (
		auth = authRepository(),
		employees = employeeRepository(),
		input = request,
	) => {
		const out = output<RegisterEmployeeAccountResponse>();
		await new RegisterEmployeeAccountInteractor(auth, employees).execute(input, out);
		expect(out.present).toHaveBeenCalledOnce();
		return { auth, employees, status: out.present.mock.calls[0][0].status };
	};

	it("verifies the code, creates the account and links it to the employee", async () => {
		const { auth, employees, status } = await register();
		expect(status).toBe("linked");
		expect(auth.verifyEmailCode).toHaveBeenCalledWith("shared@example.com", "123456");
		expect(auth.signUp).toHaveBeenCalledWith("TEST001", "Passw0rd", "shared@example.com");
		expect(employees.linkUserToEmployee).toHaveBeenCalledWith("TEST001", "auth-user");
		expect(auth.signOut).not.toHaveBeenCalled();
	});

	it("does not reuse a code that was already verified", async () => {
		const { auth, status } = await register(undefined, undefined, {
			...request,
			verificationCode: undefined,
		});
		expect(status).toBe("linked");
		expect(auth.verifyEmailCode).not.toHaveBeenCalled();
	});

	it("stops at an invalid code before touching the employee master", async () => {
		const auth = authRepository();
		auth.verifyEmailCode.mockResolvedValue({ error: new Error("expired") });
		const { employees, status } = await register(auth);
		expect(status).toBe("invalid_code");
		expect(employees.findRegistrationStatus).not.toHaveBeenCalled();
		expect(auth.signUp).not.toHaveBeenCalled();
	});

	it.each([
		["registered", "employee_registered"],
		["missing", "employee_not_found"],
	] as const)(
		"never creates an account for a %s employee number",
		async (registration, expected) => {
			const employees = employeeRepository();
			employees.findRegistrationStatus.mockResolvedValue(registration);
			const { auth, status } = await register(undefined, employees);
			expect(status).toBe(expected);
			expect(auth.signUp).not.toHaveBeenCalled();
			expect(employees.linkUserToEmployee).not.toHaveBeenCalled();
		},
	);

	it("resumes a stalled registration with the same password", async () => {
		const auth = authRepository();
		auth.signUp.mockResolvedValue({ status: "already_registered" });
		auth.signInWithPassword.mockResolvedValue({ userId: "stalled-user", error: null });
		const { employees, status } = await register(auth);
		expect(status).toBe("linked");
		expect(employees.linkUserToEmployee).toHaveBeenCalledWith("TEST001", "stalled-user");
	});

	it("does not link a stalled registration with a different password", async () => {
		const auth = authRepository();
		auth.signUp.mockResolvedValue({ status: "already_registered" });
		auth.signInWithPassword.mockResolvedValue({ userId: null, error: new Error("invalid") });
		const { employees, status } = await register(auth);
		expect(status).toBe("stalled_account");
		expect(employees.linkUserToEmployee).not.toHaveBeenCalled();
	});

	it.each([
		[Object.assign(new Error("weak"), { code: "weak_password" }), "weak_password"],
		[new Error("other"), "signup_failed"],
	] as const)("reports a sign-up failure (%s)", async (error, expected) => {
		const auth = authRepository();
		auth.signUp.mockResolvedValue({ status: "error", error });
		const { employees, status } = await register(auth);
		expect(status).toBe(expected);
		expect(employees.linkUserToEmployee).not.toHaveBeenCalled();
	});

	it("signs out when the account cannot be linked, so no unlinked session is left", async () => {
		const employees = employeeRepository();
		employees.linkUserToEmployee.mockResolvedValue(false);
		const { auth, status } = await register(undefined, employees);
		expect(status).toBe("link_failed");
		expect(auth.signOut).toHaveBeenCalledOnce();
	});
});
