import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb, uid } from "./prodLikeDb";

let db: PGlite;
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
	(await db.query<T>(sql, params)).rows;
const value = async <T>(sql: string, params: unknown[] = []) =>
	(await query<{ v: T }>(`select ${sql} as v`, params))[0].v;
beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
beforeEach(async () => {
	await db.exec(
		"reset role; update public.employees set user_id=null,is_enabled=true,role_id=1 where id=7; delete from auth.users where id='00000000-0000-0000-0000-000000000097'; delete from public.employee_invitations where employee_id=7; delete from public.registration_tickets where employee_id=7; delete from public.employee_contacts where employee_id=7;",
	);
});

afterAll(async () => {
	await db?.close();
});

it("does not expose invitations, tickets or audit writes to API callers", async () => {
	await actAs(db, 2);
	for (const table of ["employee_invitations", "registration_tickets", "security_audit_log"]) {
		if (table === "security_audit_log") {
			expect(await query(`select * from public.${table}`)).toEqual([]);
		} else {
			await expect(query(`select * from public.${table}`)).rejects.toMatchObject({ code: "42501" });
		}
	}
	await expect(value("public.issue_employee_invitation('E7')")).rejects.toMatchObject({
		code: "42501",
	});
});

it("requires a per-employee invitation even for a verified company mailbox; codes rotate and are consumed", async () => {
	await actAs(db, 1);
	const first = await value<{ code: string }>("public.issue_employee_invitation('E7')");
	const second = await value<{ code: string }>("public.issue_employee_invitation('E7')");
	await actAs(db, 98, "otp");
	const begin = (code: string, employee = "E7") =>
		value<{ status: string; token?: string }>("public.begin_registration($1,$2)", [employee, code]);
	for (const code of ["", "wrong", first.code]) {
		expect((await begin(code)).status).toBe("invalid_invitation");
	}
	expect((await begin(second.code, "E1")).status).toBe("invalid_invitation");
	const started = await begin(second.code.toLowerCase());
	expect(started.status).toBe("available");
	await db.exec("reset role");
	await query("insert into auth.users(id,email) values($1,'typa-e7@example.jp')", [uid(97)]);
	await actAs(db, 99);
	expect(await value("public.complete_registration($1)", [started.token])).toBe(false);
	await actAs(db, 97);
	expect(await value("public.complete_registration($1)", [started.token])).toBe(true);
	expect(await value("public.complete_registration($1)", [started.token])).toBe(false);
	await actAs(db, 98, "otp");
	expect((await begin(second.code)).status).toBe("invalid_invitation");
});

it("suspends immediately with an old JWT, preserves history, and requires a fresh invitation after reset", async () => {
	await actAs(db, 1);
	const invite = await value<{ code: string }>("public.issue_employee_invitation('E7')");
	await actAs(db, 98, "otp");
	const ticket = await value<{ token: string }>("public.begin_registration('E7',$1)", [
		invite.code,
	]);
	await db.exec("reset role");
	await query("insert into auth.users(id,email) values($1,'typa-e7@example.jp')", [uid(97)]);
	await actAs(db, 97);
	expect(await value("public.complete_registration($1)", [ticket.token])).toBe(true);
	await actAs(db, 1);
	expect(await value("public.set_employee_enabled('E7',false)")).toBe(true);
	await actAs(db, 97);
	expect(await value("public.current_employee_id()")).toBe(null);
	expect(await value("public.get_current_employee_access_state()")).toBe("disabled");
	expect(await query("select * from public.employees")).toEqual([]);
	expect(await query("select public.visible_employee_ids()")).toEqual([]);
	await expect(value("public.get_reviewer_workspace(1)")).rejects.toMatchObject({ code: "42501" });
	await actAs(db, 1);
	await expect(value("public.issue_employee_invitation('E7')")).rejects.toMatchObject({
		code: "23514",
	});
	await value("public.reset_employee_registration('E7')");
	await actAs(db, 98, "otp");
	expect(await value("public.begin_registration('E7','') ->> 'status'")).toBe("invalid_invitation");
	await actAs(db, 1);
	await value("public.set_employee_enabled('E7',true)");
	expect(await value("public.begin_registration('E7','') ->> 'status'").catch(() => "denied")).toBe(
		"denied",
	);
});

it("counts only registered enabled Admins, and prevents the last usable Admin from being removed", async () => {
	await actAs(db, 1);
	await value("public.set_employee_role('E7','Admin')");
	for (const operation of [
		"public.set_employee_role('E1','Employee')",
		"public.set_employee_enabled('E1',false)",
	]) {
		await expect(value(operation)).rejects.toMatchObject({ code: "23514" });
	}
});

it("lets Reviewer inspect structure, but never reassign evaluators", async () => {
	await actAs(db, 2);
	expect((await query("select id from public.employees")).length).toBeGreaterThan(1);
	expect(
		await query("update public.employees set primary_evaluator_id=2 where id=7 returning id"),
	).toEqual([]);
});

it("records management changes without persisting invitation codes or auth secrets", async () => {
	await actAs(db, 1);
	await value("public.set_employee_enabled('E7',false)");
	const audit = await query<{ details: unknown }>("select details from public.security_audit_log");
	expect(audit.length).toBeGreaterThan(0);
	expect(JSON.stringify(audit)).not.toContain("code_hash");
});

it("requires a recent OTP and rejects expired invitations", async () => {
	await actAs(db, 1);
	const invite = await value<{ code: string }>("public.issue_employee_invitation('E7')");
	await actAs(db, 98, "otp");
	await query("select set_config('request.jwt.claims',$1,false)", [
		JSON.stringify({ amr: [{ method: "otp", timestamp: 0 }] }),
	]);
	await expect(value("public.begin_registration('E7',$1)", [invite.code])).rejects.toMatchObject({
		code: "42501",
	});
	await db.exec(
		"reset role; update public.employee_invitations set expires_at=now()-interval '1 second' where employee_id=7",
	);
	await actAs(db, 98, "otp");
	expect(await value("public.begin_registration('E7',$1)->>'status'", [invite.code])).toBe(
		"invalid_invitation",
	);
});

it("issues bulk invitations only to unregistered employees without an unexpired code", async () => {
	type Issued = { employeeNo: string; code: string }[];
	await actAs(db, 2);
	await expect(value("public.issue_pending_employee_invitations()")).rejects.toMatchObject({
		code: "42501",
	});
	await actAs(db, 1);
	const first = await value<Issued>("public.issue_pending_employee_invitations()");
	expect(first.map((i) => i.employeeNo)).toEqual(["E7"]);
	expect(await value("public.issue_pending_employee_invitations()")).toEqual([]);
	await db.exec(
		"reset role; update public.employee_invitations set expires_at=now() where employee_id=7",
	);
	await actAs(db, 1);
	const renewed = await value<Issued>("public.issue_pending_employee_invitations()");
	expect(renewed.map((i) => i.employeeNo)).toEqual(["E7"]);
	expect(renewed[0].code).not.toBe(first[0].code);
	await actAs(db, 98, "otp");
	expect(
		(await value<{ status: string }>("public.begin_registration('E7',$1)", [renewed[0].code]))
			.status,
	).toBe("available");
});
