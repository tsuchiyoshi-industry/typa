import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
	signInWithPassword: vi.fn(),
	signUp: vi.fn(),
	signOut: vi.fn(),
	getSession: vi.fn(),
	onAuthStateChange: vi.fn(),
	updateUser: vi.fn(),
}));
vi.mock("../db/supabase", () => ({ supabase: { auth }, keepSignedIn: vi.fn() }));

import { SupabaseAuthRepository } from "./SupabaseAuthRepository";

const domain = (findRequiredDomain = vi.fn().mockResolvedValue("example.jp")) =>
	new SupabaseAuthRepository({ findRequiredDomain });
beforeEach(() => {
	for (const fn of Object.values(auth)) {
		fn.mockReset();
	}
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signing in with an employee number", () => {
	it("signs in with the internal address made from the employee number", async () => {
		auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
		expect(await domain().signInWithPassword("E001", "pw")).toEqual({ userId: "u1", error: null });
		expect(auth.signInWithPassword).toHaveBeenCalledWith({
			email: "typa-e001@example.jp",
			password: "pw",
		});
	});

	it.each([
		["an employee number that cannot be an address", domain(), "E 001", undefined],
		[
			"a company domain it cannot read",
			domain(vi.fn().mockRejectedValue(new Error("network"))),
			"E001",
			"unavailable",
		],
		// 会社ドメインを消すと、誰もログインできない。パスワード違いとは言わない
		[
			"a company domain that is not set",
			domain(vi.fn().mockResolvedValue("")),
			"E001",
			"unconfigured",
		],
	])("asks Auth nothing for %s", async (_label, repository, employeeNo, reason) => {
		const result = await repository.signInWithPassword(employeeNo, "pw");
		expect(result).toMatchObject({ userId: null, error: expect.any(Error) });
		expect(result.reason).toBe(reason);
		expect(auth.signInWithPassword).not.toHaveBeenCalled();
	});

	it("passes Auth's refusal on", async () => {
		const refused = new Error("Invalid login credentials");
		auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: refused });
		expect(await domain().signInWithPassword("E001", "pw")).toEqual({
			userId: null,
			error: refused,
		});
	});
});

describe("creating the login account", () => {
	const session = { access_token: "t" };
	it.each([
		[
			"a new account with a session",
			{ data: { user: { id: "u1", identities: [{}] }, session }, error: null },
			{ status: "created", userId: "u1" },
		],
		[
			"an address Auth already has",
			{ data: { user: null, session: null }, error: { code: "user_already_exists" } },
			{ status: "already_registered" },
		],
		// メール確認が有効なプロジェクトでは、登録済みのアドレスは identities が空で返る
		[
			"an address hidden behind mail confirmation",
			{ data: { user: { id: "u1", identities: [] }, session: null }, error: null },
			{ status: "already_registered" },
		],
		// 内部用アドレスに確認メールは届かないので、セッションが無ければ登録を終えられない
		[
			"an account left waiting for a confirmation mail",
			{ data: { user: { id: "u1", identities: [{}] }, session: null }, error: null },
			{ status: "error", error: expect.any(Error) },
		],
		[
			"any other refusal",
			{ data: { user: null, session: null }, error: { code: "weak_password", message: "weak" } },
			{ status: "error", error: expect.objectContaining({ code: "weak_password" }) },
		],
	])("reports %s", async (_label, response, result) => {
		auth.signUp.mockResolvedValue(response);
		expect(await domain().signUp("E001", "pw")).toEqual(result);
		expect(auth.signUp).toHaveBeenCalledWith({ email: "typa-e001@example.jp", password: "pw" });
	});

	it("creates nothing for an employee number that cannot be an address", async () => {
		expect(await domain().signUp("E 001", "pw")).toMatchObject({ status: "error" });
		expect(auth.signUp).not.toHaveBeenCalled();
	});
});

describe("the session", () => {
	it("tells the app who is signed in, and that nobody is after signing out", async () => {
		const unsubscribe = vi.fn();
		let listener: (event: string, session: unknown) => void = () => {};
		auth.onAuthStateChange.mockImplementation((callback) => {
			listener = callback;
			return { data: { subscription: { unsubscribe } } };
		});
		const seen = vi.fn();
		const stop = domain().onAuthStateChange(seen);
		listener("SIGNED_IN", { user: { id: "u1" } });
		listener("TOKEN_REFRESHED", null);
		listener("SIGNED_OUT", null);
		expect(seen.mock.calls).toEqual([[{ userId: "u1" }], [null]]);
		stop();
		expect(unsubscribe).toHaveBeenCalledOnce();

		auth.getSession.mockResolvedValue({ data: { session: null } });
		expect(await domain().getSession()).toBeNull();
	});
});

describe("changing one's own password", () => {
	it("asks Auth to change the signed-in user's password", async () => {
		auth.updateUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
		expect(await domain().changePassword("Mine1234")).toEqual({ error: null });
		expect(auth.updateUser).toHaveBeenCalledWith({ password: "Mine1234" });
	});

	it.each([
		["same_password", "same_password"],
		["weak_password", "weak_password"],
		["session_not_found", undefined],
	])("passes on Auth's refusal %s", async (code, reason) => {
		const error = Object.assign(new Error(code), { code });
		auth.updateUser.mockResolvedValue({ data: { user: null }, error });
		expect(await domain().changePassword("Mine1234")).toEqual({ error, reason });
	});
});
