import { expect, it } from "vitest";
import { profile } from "../../test/fixtures";

const withAssignments = (changes: Record<string, unknown>) =>
	Object.assign(Object.create(Object.getPrototypeOf(profile())), profile(), changes);

it("counts unset evaluators and, only for those who can fill it, the grade", () => {
	expect(profile().hasUnsetAssignment(true)).toBe(false);
	expect(withAssignments({ primaryEvaluatorId: null }).hasUnsetAssignment(false)).toBe(true);
	// 二次評価者は「なし」と明示されていれば設定済み
	expect(withAssignments({ secondaryEvaluatorId: null }).hasUnsetAssignment(false)).toBe(true);
	expect(
		withAssignments({ secondaryEvaluatorId: null, noSecondaryEvaluator: true }).hasUnsetAssignment(
			false,
		),
	).toBe(false);
	expect(withAssignments({ gradeId: null }).hasUnsetAssignment(false)).toBe(false);
	expect(withAssignments({ gradeId: null }).hasUnsetAssignment(true)).toBe(true);
});

it("leaves executives out of evaluation assignments", () => {
	const executive = withAssignments({ careerCourse: " 役員 ", primaryEvaluatorId: null });
	expect(executive.isExecutive()).toBe(true);
	expect(executive.hasUnsetAssignment(true)).toBe(false);
});
