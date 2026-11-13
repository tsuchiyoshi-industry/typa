import { describe, expect, it } from "vitest";
import { EmployeeProfile } from "../entities/EmployeeProfile";
import { EmployeeRole } from "../valueObjects/EmployeeRole";
import {
	checkEnabledChange,
	checkEvaluatorAssignment,
	checkInvitation,
	checkNewEmployee,
	checkPasswordReset,
	checkRegistrationReset,
	checkRoleChange,
	describeEmployeeAdministrationError,
	type EmployeeAdministrationError,
	isUsableAdmin,
} from "./EmployeeAdministration";

const person = (
	id: number,
	role: EmployeeRole,
	options: { registered?: boolean; enabled?: boolean; careerCourse?: string } = {},
) =>
	new EmployeeProfile(
		id,
		`社員${id}`,
		`E${id}`,
		null,
		role,
		options.careerCourse ?? "総合職",
		1,
		"等級",
		null,
		"未設定",
		null,
		"未設定",
		false,
		options.registered ?? true,
		false,
		options.enabled ?? true,
	);
const admin = person(1, EmployeeRole.ADMIN);
const failure = (result: { ok: boolean; error?: EmployeeAdministrationError }) =>
	result.ok ? null : result.error?.kind;

describe("a usable Admin", () => {
	it("is an enabled, registered Admin", () => {
		expect(isUsableAdmin(admin)).toBe(true);
		expect(isUsableAdmin(person(2, EmployeeRole.ADMIN, { enabled: false }))).toBe(false);
		expect(isUsableAdmin(person(2, EmployeeRole.ADMIN, { registered: false }))).toBe(false);
		expect(isUsableAdmin(person(2, EmployeeRole.REVIEWER))).toBe(false);
	});
});

// 利用できる Admin が0名になると、誰も権限・利用・登録を管理できなくなる
describe("keeping a usable Admin", () => {
	const other = person(2, EmployeeRole.ADMIN);
	const unusable = [
		person(3, EmployeeRole.ADMIN, { enabled: false }),
		person(4, EmployeeRole.ADMIN, { registered: false }),
		person(5, EmployeeRole.REVIEWER),
	];

	it("refuses to take the last usable Admin away, by role, suspension or reset", () => {
		const everyone = [admin, ...unusable];
		expect(failure(checkRoleChange(admin, EmployeeRole.REVIEWER, everyone))).toBe(
			"lastUsableAdmin",
		);
		expect(failure(checkEnabledChange(other, admin, false, [...everyone, other]))).toBe(null);
		expect(failure(checkEnabledChange(unusable[2], admin, false, everyone))).toBe(
			"lastUsableAdmin",
		);
		expect(failure(checkRegistrationReset(unusable[2], admin, everyone))).toBe("lastUsableAdmin");
	});

	it("allows it while another usable Admin remains", () => {
		const everyone = [admin, other];
		expect(checkRoleChange(admin, EmployeeRole.EMPLOYEE, everyone).ok).toBe(true);
		expect(checkEnabledChange(other, admin, false, everyone).ok).toBe(true);
		expect(checkRegistrationReset(other, admin, everyone).ok).toBe(true);
	});

	it("does not count Admins who cannot use the app, and ignores changes to them", () => {
		const everyone = [admin, ...unusable];
		for (const target of unusable) {
			expect(checkRoleChange(target, EmployeeRole.EMPLOYEE, everyone).ok).toBe(true);
		}
		// Admin にするのは、いつでもよい
		expect(checkRoleChange(admin, EmployeeRole.ADMIN, [admin]).ok).toBe(true);
		expect(checkEnabledChange(admin, unusable[0], true, everyone).ok).toBe(true);
	});
});

describe("the operator's own account", () => {
	const everyone = [admin, person(2, EmployeeRole.ADMIN)];

	it("cannot be suspended or reset by themselves, which would end the session they work in", () => {
		expect(failure(checkEnabledChange(admin, admin, false, everyone))).toBe("selfSuspension");
		expect(failure(checkRegistrationReset(admin, admin, everyone))).toBe("selfReset");
		// 再開は自分に対しても意味がない(止まっていれば操作できない)が、断る理由もない
		expect(checkEnabledChange(admin, admin, true, everyone).ok).toBe(true);
	});
});

describe("resetting a registration", () => {
	it("needs a registration to reset", () => {
		const unregistered = person(3, EmployeeRole.EMPLOYEE, { registered: false });
		expect(failure(checkRegistrationReset(admin, unregistered, [admin, unregistered]))).toBe(
			"notRegistered",
		);
	});
});

describe("resetting a password", () => {
	it("is for another employee who can sign in", () => {
		expect(checkPasswordReset(admin, person(3, EmployeeRole.EMPLOYEE)).ok).toBe(true);
		// 別の Admin も対象(仮のパスワードは本人が変えるまで何も読めないので、なりすましに使えない)
		expect(checkPasswordReset(admin, person(2, EmployeeRole.ADMIN)).ok).toBe(true);
	});

	it("refuses the operator, an unregistered and a suspended employee", () => {
		expect(failure(checkPasswordReset(admin, admin))).toBe("selfPasswordReset");
		expect(
			failure(checkPasswordReset(admin, person(3, EmployeeRole.EMPLOYEE, { registered: false }))),
		).toBe("notRegistered");
		expect(
			failure(checkPasswordReset(admin, person(3, EmployeeRole.EMPLOYEE, { enabled: false }))),
		).toBe("suspended");
	});
});

describe("assigning an evaluator", () => {
	const target = person(3, EmployeeRole.EMPLOYEE);

	it("accepts someone who can evaluate, or nobody", () => {
		expect(checkEvaluatorAssignment(target, person(2, EmployeeRole.REVIEWER)).ok).toBe(true);
		expect(checkEvaluatorAssignment(target, admin).ok).toBe(true);
		// 役員は、権限が Employee でも評価する側に立つ
		const executive = person(4, EmployeeRole.EMPLOYEE, { careerCourse: "役員" });
		expect(checkEvaluatorAssignment(target, executive).ok).toBe(true);
		expect(checkEvaluatorAssignment(target, null).ok).toBe(true);
	});

	it("refuses the employee themselves and someone who cannot evaluate", () => {
		expect(failure(checkEvaluatorAssignment(target, target))).toBe("selfEvaluator");
		const reviewerSelf = person(2, EmployeeRole.REVIEWER);
		expect(failure(checkEvaluatorAssignment(reviewerSelf, reviewerSelf))).toBe("selfEvaluator");
		expect(failure(checkEvaluatorAssignment(target, person(5, EmployeeRole.EMPLOYEE)))).toBe(
			"cannotEvaluate",
		);
	});
});

describe("issuing an invitation", () => {
	it("goes only to an enabled employee who has not registered yet", () => {
		expect(checkInvitation(person(3, EmployeeRole.EMPLOYEE, { registered: false })).ok).toBe(true);
		expect(
			failure(
				checkInvitation(person(3, EmployeeRole.EMPLOYEE, { registered: false, enabled: false })),
			),
		).toBe("suspended");
		expect(failure(checkInvitation(person(3, EmployeeRole.EMPLOYEE)))).toBe("alreadyRegistered");
	});
});

describe("pre-registering an employee", () => {
	const reviewer = person(2, EmployeeRole.REVIEWER);
	const employee = person(3, EmployeeRole.EMPLOYEE);
	const everyone = [admin, reviewer, employee];
	const valid = {
		employeeNo: "N1",
		name: "新入",
		careerCourse: "総合職",
		primaryEvaluatorEmployeeNo: "E2",
		secondaryEvaluatorEmployeeNo: null,
		noSecondaryEvaluator: true,
	};

	it("accepts a complete, unique employee with eligible evaluators", () => {
		expect(checkNewEmployee(valid, everyone).ok).toBe(true);
		expect(
			checkNewEmployee(
				{ ...valid, primaryEvaluatorEmployeeNo: null, noSecondaryEvaluator: false },
				everyone,
			).ok,
		).toBe(true);
	});

	it.each([
		[{ employeeNo: "N 1" }, "employeeNoInvalid"],
		[{ employeeNo: "" }, "employeeNoInvalid"],
		[{ name: "" }, "nameMissing"],
		[{ careerCourse: "技術" }, "careerCourseUnknown"],
		// ログインIDは小文字にそろえて扱うので、大文字・小文字だけが違う番号も同じ人
		[{ employeeNo: "e3" }, "employeeNoTaken"],
		[{ secondaryEvaluatorEmployeeNo: "E1" }, "secondaryConflict"],
		[{ primaryEvaluatorEmployeeNo: "E9" }, "evaluatorMissing"],
		[{ primaryEvaluatorEmployeeNo: "E3" }, "cannotEvaluate"],
	] as const)("refuses %o as %s", (change, kind) => {
		expect(failure(checkNewEmployee({ ...valid, ...change }, everyone))).toBe(kind);
	});
});

describe("describing a refusal", () => {
	it("says what to do next for every kind", () => {
		const errors: EmployeeAdministrationError[] = [
			{ kind: "lastUsableAdmin", action: "role" },
			{ kind: "lastUsableAdmin", action: "suspend" },
			{ kind: "lastUsableAdmin", action: "reset" },
			{ kind: "selfSuspension" },
			{ kind: "selfReset" },
			{ kind: "selfPasswordReset" },
			{ kind: "notRegistered", name: "社員3" },
			{ kind: "selfEvaluator" },
			{ kind: "cannotEvaluate", name: "社員3" },
			{ kind: "suspended", name: "社員3" },
			{ kind: "alreadyRegistered", name: "社員3" },
			{ kind: "employeeNoInvalid" },
			{ kind: "nameMissing" },
			{ kind: "careerCourseUnknown" },
			{ kind: "employeeNoTaken", employeeNo: "E3", name: "社員3" },
			{ kind: "secondaryConflict" },
			{ kind: "evaluatorMissing" },
		];
		for (const error of errors) {
			expect(describeEmployeeAdministrationError(error)).toMatch(/。$/);
		}
		expect(
			describeEmployeeAdministrationError({ kind: "cannotEvaluate", name: "社員3" }),
		).toContain("社員3さん");
	});
});
