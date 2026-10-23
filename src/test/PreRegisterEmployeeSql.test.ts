import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { actAs, createProdLikeDb } from "./prodLikeDb";

let db: PGlite;
const preRegister = async (
	employeeNo: string,
	options: {
		name?: string;
		grade?: number;
		primary?: string;
		secondary?: string;
		none?: boolean;
	} = {},
) =>
	(
		await db.query<{ v: boolean }>(
			"select public.pre_register_employee($1, $2, $3::smallint, '総合職', $4, $5, $6) as v",
			[
				employeeNo,
				options.name ?? "新入社員",
				options.grade ?? 1,
				options.primary ?? null,
				options.secondary ?? null,
				options.none ?? false,
			],
		)
	).rows[0].v;
const added = async () =>
	(
		await db.query<Record<string, unknown>>(
			`select e.employee_no, e.name, e.user_id, e.grade_id, e.career_course, r.role_name,
			   e.primary_evaluator_id, e.secondary_evaluator_id, e.no_secondary_evaluator
			 from public.employees e join public.roles r on r.id = e.role_id where e.id > 7 order by e.id`,
		)
	).rows;

beforeAll(async () => {
	db = await createProdLikeDb();
}, 60_000);
beforeEach(async () => {
	await db.exec(
		"reset role; delete from public.employee_invitations where employee_id > 7; delete from public.employees where id > 7; select setval('public.employees_id_seq', 7);",
	);
	await actAs(db, 1);
});
afterAll(async () => {
	await db?.close();
});

it("lets an Admin add an unregistered Employee who can then be invited", async () => {
	expect(await preRegister(" N1 ", { name: " 新入 ", primary: "E2", none: true })).toBe(true);
	expect(await preRegister("N2")).toBe(true);
	expect(await added()).toEqual([
		{
			employee_no: "N1",
			name: "新入",
			user_id: null,
			grade_id: 1,
			career_course: "総合職",
			role_name: "Employee",
			primary_evaluator_id: 2,
			secondary_evaluator_id: null,
			no_secondary_evaluator: true,
		},
		expect.objectContaining({ employee_no: "N2", primary_evaluator_id: null }),
	]);
	const invited = await db.query<{ v: { code: string } }>(
		"select public.issue_employee_invitation('N1') as v",
	);
	expect(invited.rows[0].v.code).toBeTruthy();
	await db.exec("reset role");
	const audit = await db.query(
		"select 1 from public.security_audit_log where action = 'employee.pre_registered'",
	);
	expect(audit.rows.length).toBeGreaterThanOrEqual(2);
});

it("refuses numbers that collide with an existing one, ignoring case", async () => {
	for (const no of ["E1", "e1", "E7"]) {
		await expect(preRegister(no)).rejects.toMatchObject({ code: "23505" });
	}
	expect(await added()).toEqual([]);
});

it("refuses input that would leave a broken row", async () => {
	for (const [no, options] of [
		["", {}],
		["山田", {}],
		["N 1", {}],
		["N1", { name: "  " }],
		["N1", { grade: 99 }],
		["N1", { primary: "NOBODY" }],
		["N1", { secondary: "NOBODY" }],
		["N1", { secondary: "E3", none: true }],
	] as const) {
		await expect(preRegister(no, options)).rejects.toMatchObject({ code: "22023" });
	}
	expect(await added()).toEqual([]);
});

it("denies everyone but an enabled Admin, and clients cannot insert rows directly", async () => {
	for (const id of [2, 4, 0]) {
		await actAs(db, id);
		await expect(preRegister("N9")).rejects.toMatchObject({ code: "42501" });
		await expect(
			db.query("insert into public.employees (name, employee_no) values ('直接', 'N9')"),
		).rejects.toMatchObject({ code: "42501" });
	}
	await db.exec("reset role");
	expect(await added()).toEqual([]);
});
