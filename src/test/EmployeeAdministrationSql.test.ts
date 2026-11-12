import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { EmployeeProfile } from "../domain/entities/EmployeeProfile";
import {
	checkEnabledChange,
	checkEvaluatorAssignment,
	checkInvitation,
	checkNewEmployee,
	checkRegistrationReset,
	checkRoleChange,
	type NewEmployeeDraft,
} from "../domain/services/EmployeeAdministration";
import { EmployeeRole } from "../domain/valueObjects/EmployeeRole";
import { actAs, createProdLikeDb } from "./prodLikeDb";

/**
 * 社員の管理操作のきまりは、ドメイン(EmployeeAdministration)が決める。DB の関数・トリガーが、
 * 同じ場面で同じ答え(通す・断る)を出すかを突き合わせる。どの場面も、試した後に巻き戻す。
 */
let db: PGlite;

// 社員 1: Admin(操作する人) 2・3: Reviewer 4・5・6: Employee 7: 未登録
beforeAll(async () => {
	db = await createProdLikeDb();
	// 種データは id を指定して入れているので、仮登録が次の番号から振れるようにする
	await db.exec("select setval('public.employees_id_seq', 7);");
}, 60_000);
afterAll(async () => {
	await db?.close();
});

/** DB にいまある社員を、ドメインの社員として読む(DB の所有者として)。 */
async function everyone(): Promise<EmployeeProfile[]> {
	await db.exec("reset role");
	const rows = (
		await db.query<{
			id: number;
			name: string;
			employee_no: string;
			role_name: string;
			career_course: string | null;
			registered: boolean;
			is_enabled: boolean;
		}>(`select e.id, e.name, e.employee_no, r.role_name, e.career_course,
				e.user_id is not null as registered, e.is_enabled
			from public.employees e join public.roles r on r.id = e.role_id order by e.id`)
	).rows;
	return rows.map(
		(row) =>
			new EmployeeProfile(
				row.id,
				row.name,
				row.employee_no,
				null,
				EmployeeRole.fromStored(row.role_name),
				row.career_course,
				null,
				"未設定",
				null,
				"未設定",
				null,
				"未設定",
				false,
				row.registered,
				false,
				row.is_enabled,
			),
	);
}

/** DB が断った理由(試験が失敗したときに読む)。 */
const refusals: string[] = [];

/** 場面を作り(setup)、ドメインの答えを出してから、Admin(社員 1)として DB で試す。DB は巻き戻す。 */
async function scenario(
	setup: string,
	decide: (people: EmployeeProfile[]) => boolean,
	attempt: string,
): Promise<{ domain: boolean; db: boolean }> {
	await db.exec("reset role; begin;");
	try {
		await db.exec(setup);
		const domain = decide(await everyone());
		await actAs(db, 1);
		const answered = await db
			.query<{ v: unknown }>(attempt)
			.then((result) => result.rows[0]?.v !== false)
			.catch((error: Error) => {
				refusals.push(error.message);
				return false;
			});
		return { domain, db: answered };
	} finally {
		// 失敗した試みで中断した取引も、先に巻き戻してから役割を戻す
		await db.exec("rollback; reset role;");
	}
}
const find = (people: EmployeeProfile[], id: number) => {
	const found = people.find((person) => person.id === id);
	if (!found) {
		throw new Error(`no employee ${id}`);
	}
	return found;
};

// 社員 2 を、利用できる Admin・停止中の Admin・未登録の Admin・Reviewer にして試す
const SECOND = {
	"a usable Admin": "update public.employees set role_id = 3 where id = 2;",
	"a suspended Admin": "update public.employees set role_id = 3, is_enabled = false where id = 2;",
	"an unregistered Admin":
		"update public.employees set role_id = 3, user_id = null where id = 2; delete from auth.users where id = '00000000-0000-0000-0000-000000000002';",
	"a Reviewer": "",
};

it.each(Object.entries(SECOND))(
	"keeps a usable Admin exactly as the domain says, when employee 2 is %s",
	async (_label, setup) => {
		for (const target of [1, 2]) {
			const demote = await scenario(
				setup,
				(people) => checkRoleChange(find(people, target), EmployeeRole.REVIEWER, people).ok,
				`select public.set_employee_role('E${target}', 'Reviewer') as v`,
			);
			expect(demote, `demote ${target}`).toEqual({ domain: demote.domain, db: demote.domain });
			const suspend = await scenario(
				setup,
				(people) => checkEnabledChange(find(people, 1), find(people, target), false, people).ok,
				`select public.set_employee_enabled('E${target}', false) as v`,
			);
			expect(suspend, `suspend ${target}`).toEqual({ domain: suspend.domain, db: suspend.domain });
			const reset = await scenario(
				setup,
				(people) => checkRegistrationReset(find(people, 1), find(people, target), people).ok,
				`select public.reset_employee_registration('E${target}') as v`,
			);
			expect(reset, `reset ${target}`).toEqual({ domain: reset.domain, db: reset.domain });
		}
	},
);

it("refuses the operator's own suspension and reset, as the domain does", async () => {
	for (const [decide, attempt] of [
		[
			(people: EmployeeProfile[]) =>
				checkEnabledChange(find(people, 1), find(people, 1), false, people).ok,
			"select public.set_employee_enabled('E1', false) as v",
		],
		[
			(people: EmployeeProfile[]) =>
				checkRegistrationReset(find(people, 1), find(people, 1), people).ok,
			"select public.reset_employee_registration('E1') as v",
		],
	] as const) {
		// 別の利用できる Admin がいても、自分は止めない・消さない
		expect(await scenario(SECOND["a usable Admin"], decide, attempt)).toEqual({
			domain: false,
			db: false,
		});
	}
});

it.each([
	["an Admin", 1, ""],
	["a Reviewer", 2, ""],
	["an Employee", 5, ""],
	["an executive Employee", 5, "update public.employees set career_course = '役員' where id = 5;"],
	["the employee themselves", 4, ""],
])("assigns %s as an evaluator exactly as the domain says", async (_label, evaluator, setup) => {
	for (const column of ["primary_evaluator_id", "secondary_evaluator_id"]) {
		const result = await scenario(
			setup,
			(people) => checkEvaluatorAssignment(find(people, 4), find(people, evaluator)).ok,
			`with changed as (update public.employees set ${column} = ${evaluator} where id = 4 returning id)
				select count(*) = 1 as v from changed`,
		);
		expect(result, column).toEqual({ domain: result.domain, db: result.domain });
	}
});

it.each([
	["an unregistered employee", 7, ""],
	[
		"a suspended unregistered employee",
		7,
		"update public.employees set is_enabled = false where id = 7;",
	],
	["a registered employee", 4, ""],
])("invites %s exactly as the domain says", async (_label, target, setup) => {
	const result = await scenario(
		setup,
		(people) => checkInvitation(find(people, target)).ok,
		`select public.issue_employee_invitation('E${target}') is not null as v`,
	);
	expect(result, refusals[refusals.length - 1]).toEqual({
		domain: result.domain,
		db: result.domain,
	});
});

const VALID: NewEmployeeDraft = {
	employeeNo: "N1",
	name: "新入",
	careerCourse: "総合職",
	primaryEvaluatorEmployeeNo: "E2",
	secondaryEvaluatorEmployeeNo: null,
	noSecondaryEvaluator: true,
};
it.each([
	["a complete employee", {}],
	[
		"an employee without evaluators yet",
		{ primaryEvaluatorEmployeeNo: null, noSecondaryEvaluator: false },
	],
	["an employee number with a space", { employeeNo: "N 1" }],
	["an empty name", { name: "" }],
	["an unknown career course", { careerCourse: "技術" }],
	["an executive", { careerCourse: "役員" }],
	["a number taken in another case", { employeeNo: "e3" }],
	["a secondary evaluator and 'none' together", { secondaryEvaluatorEmployeeNo: "E3" }],
	["a missing evaluator", { primaryEvaluatorEmployeeNo: "E9" }],
	["an Employee as the evaluator", { primaryEvaluatorEmployeeNo: "E5" }],
	[
		"an Employee as the secondary evaluator",
		{ secondaryEvaluatorEmployeeNo: "E5", noSecondaryEvaluator: false },
	],
] as const)("pre-registers %s exactly as the domain says", async (_label, change) => {
	const draft: NewEmployeeDraft = { ...VALID, ...change };
	const literal = (value: string | null) =>
		value === null ? "null" : `'${value.split("'").join("''")}'`;
	const result = await scenario(
		"",
		(people) => checkNewEmployee(draft, people).ok,
		`select public.pre_register_employee(${literal(draft.employeeNo)}, ${literal(draft.name)}, 1::smallint,
			${literal(draft.careerCourse)}, ${literal(draft.primaryEvaluatorEmployeeNo)},
			${literal(draft.secondaryEvaluatorEmployeeNo)}, ${draft.noSecondaryEvaluator}) as v`,
	);
	expect(result, refusals[refusals.length - 1]).toEqual({
		domain: result.domain,
		db: result.domain,
	});
});
