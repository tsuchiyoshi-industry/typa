import { describe, expect, it } from "vitest";
import { authRepository, employeeRepository, output } from "../../test/fixtures";
import {
	ChangeOwnPasswordInteractor,
	type ChangeOwnPasswordResponse,
} from "./ChangeOwnPasswordInteractor";
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

	it.each([
		["unconfigured", "the company domain for login addresses is not set"],
		["unavailable", "the company domain could not be read"],
	] as const)("says %s, not wrong credentials, when %s", async (reason, _when) => {
		const auth = authRepository();
		auth.signInWithPassword.mockResolvedValue({ userId: null, error: new Error(reason), reason });
		const { employees, status } = await signIn(auth);
		expect(status).toBe(reason);
		expect(employees.checkUserLinked).not.toHaveBeenCalled();
	});

	it("signs out an account that is not linked to an employee", async () => {
		const employees = employeeRepository();
		employees.checkUserLinked.mockResolvedValue(false);
		const { auth, status } = await signIn(undefined, employees);
		expect(status).toBe("registration_incomplete");
		expect(auth.signOut).toHaveBeenCalledOnce();
	});
	it("says it could not check the account, instead of sending a registered person to register again", async () => {
		const employees = employeeRepository();
		employees.checkUserLinked.mockRejectedValue(new Error("network"));
		const { auth, status } = await signIn(undefined, employees);
		expect(status).toBe("unavailable");
		// 紐付いているか分からないセッションも残さない
		expect(auth.signOut).toHaveBeenCalledOnce();
		expect(employees.findCurrentAccessState).not.toHaveBeenCalled();
	});
	it("explains suspension without sending the user through registration", async () => {
		const employees = employeeRepository();
		employees.checkUserLinked.mockResolvedValue(false);
		employees.findCurrentAccessState.mockResolvedValue("disabled");
		const { auth, status } = await signIn(undefined, employees);
		expect(status).toBe("account_disabled");
		expect(auth.signOut).toHaveBeenCalledOnce();
	});
});

describe("sign in with a temporary password set by an Admin", () => {
	it("keeps the session so the employee can choose their own password", async () => {
		const auth = authRepository();
		const employees = employeeRepository();
		employees.checkUserLinked.mockResolvedValue(false);
		employees.findCurrentAccessState.mockResolvedValue("password_change_required");
		const out = output<SignInEmployeeResponse>();
		await new SignInEmployeeInteractor(auth, employees).execute(
			{ employeeNo: "TEST001", password: "TempPass1" },
			out,
		);
		expect(out.present).toHaveBeenCalledWith({ status: "password_change_required" });
		expect(auth.signOut).not.toHaveBeenCalled();
	});
});

describe("change one's own password after a temporary one", () => {
	const change = async (
		password: string,
		auth = authRepository(),
		employees = employeeRepository(),
	) => {
		const out = output<ChangeOwnPasswordResponse>();
		await new ChangeOwnPasswordInteractor(auth, employees).execute({ password }, out);
		expect(out.present).toHaveBeenCalledOnce();
		return { auth, employees, status: out.present.mock.calls[0][0].status };
	};

	it("changes the password through Auth and confirms the DB lets the employee in", async () => {
		const { auth, employees, status } = await change("Mine1234");
		expect(status).toBe("changed");
		expect(auth.changePassword).toHaveBeenCalledWith("Mine1234");
		expect(employees.checkUserLinked).toHaveBeenCalledWith("auth-user");
	});

	it.each(["", "Ab1", "alllower1", "ALLUPPER1", "NoDigits"])(
		"refuses a weak password (%s) without asking Auth",
		async (password) => {
			const { auth, status } = await change(password);
			expect(status).toBe("weak_password");
			expect(auth.changePassword).not.toHaveBeenCalled();
		},
	);

	it.each([
		["same_password", "same_password"],
		["weak_password", "weak_password"],
		[undefined, "failed"],
	] as const)(
		"reports Auth's refusal (%s) and keeps the session to retry",
		async (reason, status) => {
			const auth = authRepository();
			auth.changePassword.mockResolvedValue({ error: new Error("refused"), reason });
			const result = await change("Mine1234", auth);
			expect(result.status).toBe(status);
			expect(auth.signOut).not.toHaveBeenCalled();
			expect(result.employees.checkUserLinked).not.toHaveBeenCalled();
		},
	);

	it.each([
		["still blocked", () => Promise.resolve(false)],
		["unreadable", () => Promise.reject(new Error("network"))],
	])("does not claim success when the DB is %s afterwards", async (_case, linked) => {
		const employees = employeeRepository();
		employees.checkUserLinked.mockImplementation(linked);
		const { status } = await change("Mine1234", undefined, employees);
		expect(status).toBe("unavailable");
	});

	it("refuses when nobody is signed in", async () => {
		const auth = authRepository();
		auth.getSession.mockResolvedValue(null);
		auth.changePassword.mockResolvedValue({ error: new Error("no session") });
		const { status } = await change("Mine1234", auth);
		expect(status).toBe("failed");
	});
});

describe("register an employee account", () => {
	const request: RegisterEmployeeAccountRequest = {
		invitationCode: "personal-invite",
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
		expect(employees.beginRegistration).toHaveBeenCalledWith("TEST001", "personal-invite");
		expect(auth.signUp).toHaveBeenCalledWith("TEST001", "Passw0rd");
		// 紐付けに使うのは、登録を始めたときに DB が発行したトークン
		expect(employees.completeRegistration).toHaveBeenCalledWith("ticket");
		// アカウントを作る前に、会社のメールアドレスを確認したセッションで登録を始める
		expect(employees.beginRegistration.mock.invocationCallOrder[0]).toBeLessThan(
			auth.signUp.mock.invocationCallOrder[0],
		);
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
		expect(employees.beginRegistration).not.toHaveBeenCalled();
		expect(auth.signUp).not.toHaveBeenCalled();
	});

	it.each([
		["registered", "employee_registered"],
		["missing", "employee_not_found"],
		["invalid_invitation", "invalid_invitation"],
	] as const)(
		"never creates an account for a %s employee number",
		async (registration, expected) => {
			const employees = employeeRepository();
			employees.beginRegistration.mockResolvedValue({ status: registration });
			const { auth, status } = await register(undefined, employees);
			expect(status).toBe(expected);
			expect(auth.signUp).not.toHaveBeenCalled();
			expect(employees.completeRegistration).not.toHaveBeenCalled();
		},
	);

	it("resumes a stalled registration with the same password", async () => {
		const auth = authRepository();
		auth.signUp.mockResolvedValue({ status: "already_registered" });
		auth.signInWithPassword.mockResolvedValue({ userId: "stalled-user", error: null });
		const { employees, status } = await register(auth);
		expect(status).toBe("linked");
		expect(auth.signInWithPassword).toHaveBeenCalledWith("TEST001", "Passw0rd");
		expect(employees.completeRegistration).toHaveBeenCalledWith("ticket");
	});

	it("does not link a stalled registration with a different password", async () => {
		const auth = authRepository();
		auth.signUp.mockResolvedValue({ status: "already_registered" });
		auth.signInWithPassword.mockResolvedValue({ userId: null, error: new Error("invalid") });
		const { employees, status } = await register(auth);
		expect(status).toBe("stalled_account");
		expect(employees.completeRegistration).not.toHaveBeenCalled();
	});

	it.each([
		[Object.assign(new Error("weak"), { code: "weak_password" }), "weak_password"],
		[new Error("other"), "signup_failed"],
	] as const)("reports a sign-up failure (%s)", async (error, expected) => {
		const auth = authRepository();
		auth.signUp.mockResolvedValue({ status: "error", error });
		const { employees, status } = await register(auth);
		expect(status).toBe(expected);
		expect(employees.completeRegistration).not.toHaveBeenCalled();
	});

	it("signs out when the account cannot be linked, so no unlinked session is left", async () => {
		const employees = employeeRepository();
		employees.completeRegistration.mockResolvedValue(false);
		const { auth, status } = await register(undefined, employees);
		expect(status).toBe("link_failed");
		expect(auth.signOut).toHaveBeenCalledOnce();
	});

	it("starts over when the mailbox is no longer verified, without creating an account", async () => {
		const employees = employeeRepository();
		employees.beginRegistration.mockRejectedValue(new Error("denied"));
		const { auth, status } = await register(undefined, employees);
		expect(status).toBe("link_failed");
		expect(auth.signUp).not.toHaveBeenCalled();
		expect(auth.signOut).toHaveBeenCalledOnce();
	});
});
