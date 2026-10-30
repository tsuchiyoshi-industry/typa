import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("../db/supabase", () => ({
	supabase: { from: db.from, rpc: db.rpc, auth: { getSession: db.getSession } },
}));

import { SupabaseEmployeeRepository } from "./SupabaseEmployeeRepository";

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const failed: Result = { data: null, error: { message: "network" } };

/** 1件・一覧のどちらで引いても result を返す。 */
function table(result: Result) {
	const builder = Promise.resolve(result) as Promise<Result> & Record<string, unknown>;
	for (const name of ["select", "eq"]) {
		builder[name] = () => builder;
	}
	builder.maybeSingle = () => Promise.resolve(result);
	db.from.mockReturnValue(builder);
}
const signedIn = (userId: string | null) =>
	db.getSession.mockResolvedValue({
		data: { session: userId ? { user: { id: userId } } : null },
		error: null,
	});
beforeEach(() => {
	db.from.mockReset();
	db.rpc.mockReset();
	db.getSession.mockReset();
});

describe("registration", () => {
	it.each([
		[
			{ status: "available", token: "t1" },
			{ status: "available", token: "t1" },
		],
		[{ status: "registered" }, { status: "registered" }],
		[{ status: "missing" }, { status: "missing" }],
		[{ status: "invalid_invitation" }, { status: "invalid_invitation" }],
		// トークンの無い available や、知らない答えで登録を進めない
		[{ status: "available" }, { status: "invalid_invitation" }],
		[{ status: "something new" }, { status: "invalid_invitation" }],
		[null, { status: "invalid_invitation" }],
	])("reads the start of a registration %o as %o", async (answer, start) => {
		db.rpc.mockResolvedValue(ok(answer));
		expect(await new SupabaseEmployeeRepository().beginRegistration("E1", "CODE")).toEqual(start);
		expect(db.rpc).toHaveBeenCalledWith("begin_registration", {
			p_employee_no: "E1",
			p_invitation_code: "CODE",
		});
	});

	it("fails the start when the mailbox session is no longer valid", async () => {
		db.rpc.mockResolvedValue(failed);
		await expect(new SupabaseEmployeeRepository().beginRegistration("E1")).rejects.toThrow();
	});

	it.each([
		[ok(true), true],
		[ok(false), false],
		[ok(null), false],
		[failed, false],
	])("links the employee only when the database says %o", async (answer, linked) => {
		db.rpc.mockResolvedValue(answer);
		expect(await new SupabaseEmployeeRepository().completeRegistration("t1")).toBe(linked);
	});
});

describe("the signed-in account", () => {
	it.each([
		[ok("enabled"), "enabled"],
		[ok("disabled"), "disabled"],
		[ok(null), "unregistered"],
		[ok("unknown"), "unregistered"],
		[failed, "unregistered"],
	])("reads the access state %o as %s", async (answer, state) => {
		db.rpc.mockResolvedValue(answer);
		expect(await new SupabaseEmployeeRepository().findCurrentAccessState()).toBe(state);
	});

	it("tells a linked account from an unlinked one, and fails when it cannot tell", async () => {
		const repository = new SupabaseEmployeeRepository();
		table(ok({ id: 1 }));
		expect(await repository.checkUserLinked("u1")).toBe(true);
		table(ok(null));
		expect(await repository.checkUserLinked("u1")).toBe(false);
		// 読めなかったことを「紐付いていない(登録が終わっていない)」と言わない
		table(failed);
		await expect(repository.checkUserLinked("u1")).rejects.toThrow();
	});

	it("keeps the session only when the employee master says so, and not when it cannot be read", async () => {
		const repository = new SupabaseEmployeeRepository();
		table(ok({ keep_signed_in: true }));
		expect(await repository.findKeepSignedIn("u1")).toBe(true);
		for (const answer of [ok({ keep_signed_in: false }), ok(null), failed]) {
			table(answer);
			expect(await repository.findKeepSignedIn("u1")).toBe(false);
		}
	});

	it("finds the employee once per account, and reports a failed lookup as an error", async () => {
		const repository = new SupabaseEmployeeRepository();
		signedIn(null);
		expect(await repository.findCurrentEmployeeId()).toEqual({ data: null, error: null });
		signedIn("u1");
		table(ok({ id: 7 }));
		expect(await repository.findCurrentEmployeeId()).toEqual({ data: 7, error: null });
		await repository.findCurrentEmployeeId();
		expect(db.from).toHaveBeenCalledOnce();

		const failing = new SupabaseEmployeeRepository();
		table(failed);
		expect((await failing.findCurrentEmployeeId()).error).toBeInstanceOf(Error);
		// 失敗は覚えておかず、次は読み直す
		table(ok({ id: 7 }));
		expect(await failing.findCurrentEmployeeId()).toEqual({ data: 7, error: null });
	});
});

describe("grade names", () => {
	it("reads the names once, and shows an unknown or missing grade as unset", async () => {
		const repository = new SupabaseEmployeeRepository();
		table(ok([{ id: 2, grade_name: "総合職2級" }]));
		expect(await repository.findGradeName(2)).toBe("総合職2級");
		expect(await repository.findGradeName(9)).toBe("未設定");
		expect(await repository.findGradeName(null)).toBe("未設定");
		expect(db.from).toHaveBeenCalledOnce();
	});

	it("tries again after the names could not be read", async () => {
		const repository = new SupabaseEmployeeRepository();
		table(failed);
		expect(await repository.findGradeName(2)).toBe("未設定");
		table(ok([{ id: 2, grade_name: "総合職2級" }]));
		expect(await repository.findGradeName(2)).toBe("総合職2級");
	});
});
