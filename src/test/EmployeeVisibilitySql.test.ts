import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	canViewAllEmployees,
	canViewEmployeeDetail,
	EMPLOYEE_DETAILS,
	type EmployeeDetail,
	type EvaluationLink,
	evaluationColleagueIds,
} from "../domain/services/EmployeeMasterAccessService";
import { EmployeeRole } from "../domain/valueObjects/EmployeeRole";
import { actAs, createProdLikeDb, rollbackAfterTest } from "./prodLikeDb";

/**
 * 社員マスタで誰の何を見られるかは、ドメイン(EmployeeMasterAccessService)が決める。
 * DB(employees の行ポリシーと列の権限、employee_details())がその判定どおりに答えるかを、全員分突き合わせる。
 */
let db: PGlite;
const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows;

interface Truth extends EvaluationLink {
	role_name: string;
	grade_id: number | null;
	keep_signed_in: boolean;
	user_id: string | null;
	is_enabled: boolean;
}
interface DetailRow {
	employee_id: number;
	grade_id: number | null;
	role_name: string | null;
	keep_signed_in: boolean | null;
	user_id: string | null;
	registered: boolean | null;
	enabled: boolean | null;
}

/** ドメインの項目ごとに、employee_details() のどの列が答えるか。 */
const DETAIL_COLUMNS: Record<EmployeeDetail, (keyof DetailRow)[]> = {
	grade: ["grade_id"],
	role: ["role_name"],
	keepSignedIn: ["keep_signed_in"],
	account: ["user_id", "registered", "enabled"],
};
const truthOf = (truth: Truth): Omit<DetailRow, "employee_id"> => ({
	grade_id: truth.grade_id,
	role_name: truth.role_name,
	keep_signed_in: truth.keep_signed_in,
	user_id: truth.user_id,
	registered: truth.user_id !== null,
	enabled: truth.is_enabled,
});
const RESTRICTED = ["grade_id", "role_id", "keep_signed_in", "user_id", "is_enabled"];

// 社員 1: Admin 2・3: Reviewer(4 の一次・二次) 4: 本人 5: 無関係 6: 二次なしの本人(一次は 2) 7: 未登録
/** 異動前の記録として、締めた期間のシート(本人 5、評価者 6・3)と、ログインを保持する社員を足す。 */
async function seed(target: PGlite) {
	await target.exec(`
		set session_replication_role = replica;
		insert into public.evaluation_sheets (id, period_id, employee_id, primary_evaluator_id, secondary_evaluator_id, status, grade_id)
		values (700, 2, 5, 6, 3, 'finalized', 1);
		update public.employees set keep_signed_in = true where id in (2, 4);
		set session_replication_role = origin;
	`);
}

beforeAll(async () => {
	db = await createProdLikeDb();
	await seed(db);
}, 60_000);
afterAll(async () => {
	await db?.close();
});

async function truth(): Promise<{ employees: Truth[]; sheets: EvaluationLink[] }> {
	await db.exec("reset role");
	const employees = await rows<Truth>(`
		select e.id as "employeeId", e.primary_evaluator_id as "primaryEvaluatorId",
			e.secondary_evaluator_id as "secondaryEvaluatorId", r.role_name, e.grade_id, e.keep_signed_in,
			e.user_id, e.is_enabled
		from public.employees e join public.roles r on r.id = e.role_id order by e.id`);
	const sheets = await rows<EvaluationLink>(`
		select employee_id::integer as "employeeId", primary_evaluator_id as "primaryEvaluatorId",
			secondary_evaluator_id as "secondaryEvaluatorId" from public.evaluation_sheets`);
	return { employees, sheets };
}

async function expectDbFollowsDomain() {
	const { employees, sheets } = await truth();
	for (const viewer of employees.filter((employee) => employee.user_id && employee.is_enabled)) {
		const role = EmployeeRole.fromStored(viewer.role_name);
		const visible = canViewAllEmployees(role)
			? employees.map((employee) => employee.employeeId)
			: [...evaluationColleagueIds(viewer.employeeId, employees, sheets)].sort((a, b) => a - b);
		await actAs(db, viewer.employeeId);
		const label = `employee ${viewer.employeeId} (${role.toString()})`;
		const seen = await rows<{ id: number }>("select id from public.employees order by id");
		expect(
			seen.map((row) => row.id),
			label,
		).toEqual(visible);

		const details = await rows<DetailRow>(
			"select * from public.employee_details() order by employee_id",
		);
		expect(
			details.map((row) => row.employee_id),
			label,
		).toEqual(visible);
		for (const row of details) {
			const own = row.employee_id === viewer.employeeId;
			const stored = employees.find((employee) => employee.employeeId === row.employee_id);
			if (!stored) {
				throw new Error(`employee_details returned unknown employee ${row.employee_id}`);
			}
			const actual = truthOf(stored);
			for (const detail of EMPLOYEE_DETAILS) {
				const shown = canViewEmployeeDetail(role, detail, own);
				for (const column of DETAIL_COLUMNS[detail]) {
					expect(row[column], `${label} sees ${column} of ${row.employee_id}`).toEqual(
						shown ? actual[column as keyof typeof actual] : null,
					);
				}
			}
		}
	}
}

it("shows each employee exactly the rows and details the domain allows", async () => {
	await expectDbFollowsDomain();
});

it("keeps following the domain after the evaluators change", async () => {
	await rollbackAfterTest(db);
	await actAs(db, 1);
	await rows(
		"update public.employees set primary_evaluator_id = 1, secondary_evaluator_id = null where id = 4",
	);
	await expectDbFollowsDomain();
});

it("answers restricted columns only through employee_details(), never through the table", async () => {
	for (const id of [1, 2, 4]) {
		await actAs(db, id);
		for (const column of RESTRICTED) {
			await expect(
				rows(`select ${column} from public.employees where id = ${id}`),
				`employee ${id} reads ${column}`,
			).rejects.toMatchObject({ code: "42501" });
		}
		await expect(rows("select * from public.employees")).rejects.toMatchObject({ code: "42501" });
	}
});

it("gives nothing to a suspended Admin, an account without an employee, or before sign-in", async () => {
	await rollbackAfterTest(db);
	await db.exec("reset role; update public.employees set is_enabled = false where id = 1");
	for (const id of [1, 99]) {
		await actAs(db, id);
		expect(await rows("select * from public.employee_details()")).toEqual([]);
		expect(await rows("select id from public.employees")).toEqual([]);
	}
	await actAs(db, 0);
	await expect(rows("select * from public.employee_details()")).rejects.toMatchObject({
		code: "42501",
	});
});

it("still lets an Admin change a grade and the sign-in setting, and nobody else", async () => {
	await rollbackAfterTest(db);
	const change = () =>
		rows(
			"update public.employees set grade_id = 2, keep_signed_in = true where id = 5 returning id",
		);
	for (const id of [2, 4]) {
		await actAs(db, id);
		expect(await change()).toEqual([]);
	}
	await actAs(db, 1);
	expect(await change()).toEqual([{ id: 5 }]);
});
