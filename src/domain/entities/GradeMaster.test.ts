import { describe, expect, it } from "vitest";
import {
	type CommonGoalSet,
	CommonGoalSetChange,
	canDeleteCommonGoalSet,
	canDeleteGrade,
	GradeChange,
	type GradeEntry,
} from "./GradeMaster";

const grade: GradeEntry = { id: 3, name: "技能1級", itemSetId: 2, employeeCount: 0, sheetCount: 0 };
const set: CommonGoalSet = {
	id: 2,
	name: "一般",
	sheetCount: 4,
	items: [
		{ id: 10, title: "協調性", description: "説明", weight: 2 },
		{ id: 11, title: "専門性", description: "", weight: 1 },
	],
};
const item = { id: null, title: "品質", description: "", weight: 1 };

describe("a grade change", () => {
	it("trims the name and keeps what was shown, for the database to detect a conflict", () => {
		const change = GradeChange.from({ name: " 技能Ⅰ級 ", itemSetId: 1, shown: grade });
		expect(change).toEqual({
			ok: true,
			value: expect.objectContaining({
				id: 3,
				name: "技能Ⅰ級",
				itemSetId: 1,
				expected: { name: "技能1級", itemSetId: 2 },
			}),
		});
	});

	it("adds a grade when nothing was shown", () => {
		const change = GradeChange.from({ name: "総合1級", itemSetId: 1, shown: null });
		expect(change.ok && change.value).toMatchObject({ id: null, expected: null });
	});

	it.each([
		["a blank name", { name: "  ", itemSetId: 1 }, "nameInvalid"],
		["a name over 50 characters", { name: "級".repeat(51), itemSetId: 1 }, "nameInvalid"],
		["no common goals", { name: "総合1級", itemSetId: null }, "itemSetRequired"],
	] as const)("refuses %s", (_, request, kind) => {
		expect(GradeChange.from({ ...request, shown: null })).toEqual({ ok: false, error: { kind } });
	});

	it("counts a surrogate pair as one character", () => {
		expect(GradeChange.from({ name: "𠮷".repeat(50), itemSetId: 1, shown: null }).ok).toBe(true);
	});
});

describe("deleting a grade", () => {
	it("is possible only while nobody holds it and no sheet was made with it", () => {
		expect(canDeleteGrade(grade)).toEqual({ ok: true, value: undefined });
		expect(canDeleteGrade({ ...grade, employeeCount: 2, sheetCount: 5 })).toEqual({
			ok: false,
			error: { kind: "gradeInUse", employees: 2, sheets: 5 },
		});
		expect(canDeleteGrade({ ...grade, sheetCount: 1 }).ok).toBe(false);
	});
});

describe("a common goal set change", () => {
	it("trims names and titles and keeps what was shown", () => {
		const change = CommonGoalSetChange.from({
			name: " 一般 ",
			items: [{ id: 10, title: " 協調性 ", description: "説明", weight: 2 }, item],
			shown: set,
		});
		expect(change.ok && change.value).toMatchObject({
			id: 2,
			name: "一般",
			items: [{ id: 10, title: "協調性", description: "説明", weight: 2 }, item],
			expected: { name: "一般", items: set.items },
		});
	});

	it.each([
		["a blank name", { name: " ", items: [item] }, { kind: "setNameInvalid" }],
		["no items", { name: "一般", items: [] }, { kind: "itemsRequired" }],
		[
			"more than 30 items",
			{
				name: "一般",
				items: Array.from({ length: 31 }, (_, i) => ({ ...item, title: `項目${i}` })),
			},
			{ kind: "tooManyItems" },
		],
		[
			"a blank title",
			{ name: "一般", items: [item, { ...item, title: " " }] },
			{ kind: "titleInvalid", row: 2 },
		],
		[
			"a title over 100 characters",
			{ name: "一般", items: [{ ...item, title: "項".repeat(101) }] },
			{ kind: "titleInvalid", row: 1 },
		],
		[
			"a description over 1000 characters",
			{ name: "一般", items: [{ ...item, description: "説".repeat(1001) }] },
			{ kind: "descriptionTooLong", row: 1 },
		],
		[
			"a weight of 0",
			{ name: "一般", items: [{ ...item, weight: 0 }] },
			{ kind: "weightInvalid", row: 1 },
		],
		[
			"a weight of 11",
			{ name: "一般", items: [{ ...item, weight: 11 }] },
			{ kind: "weightInvalid", row: 1 },
		],
		[
			"a fractional weight",
			{ name: "一般", items: [{ ...item, weight: 1.5 }] },
			{ kind: "weightInvalid", row: 1 },
		],
		[
			"an empty weight",
			{ name: "一般", items: [{ ...item, weight: Number.NaN }] },
			{ kind: "weightInvalid", row: 1 },
		],
		[
			"the same title twice",
			{ name: "一般", items: [item, { ...item, title: " 品質" }] },
			{ kind: "duplicateTitle", title: "品質" },
		],
	] as const)("refuses %s", (_, request, error) => {
		expect(CommonGoalSetChange.from({ ...request, shown: null })).toEqual({ ok: false, error });
	});

	it("makes a new version only when the items of a set that sheets use change", () => {
		const same = CommonGoalSetChange.from({ name: "一般(改)", items: set.items, shown: set });
		expect(same.ok && same.value.makesNewVersion()).toBe(false);
		const edited = CommonGoalSetChange.from({
			name: "一般",
			items: [{ ...set.items[0], weight: 3 }, set.items[1]],
			shown: set,
		});
		expect(edited.ok && edited.value.makesNewVersion()).toBe(true);
		const added = CommonGoalSetChange.from({
			name: "一般",
			items: [...set.items, item],
			shown: set,
		});
		expect(added.ok && added.value.makesNewVersion()).toBe(true);
		const unused = CommonGoalSetChange.from({
			name: "一般",
			items: [item],
			shown: { ...set, sheetCount: 0 },
		});
		expect(unused.ok && unused.value.makesNewVersion()).toBe(false);
	});
});

describe("deleting a common goal set", () => {
	it("is possible only while no grade and no sheet uses it", () => {
		const unused = { ...set, sheetCount: 0 };
		expect(canDeleteCommonGoalSet(unused, [{ ...grade, itemSetId: 1 }])).toEqual({
			ok: true,
			value: undefined,
		});
		expect(canDeleteCommonGoalSet(unused, [grade, { ...grade, id: 4, name: "技能2級" }])).toEqual({
			ok: false,
			error: { kind: "setInUse", grades: ["技能1級", "技能2級"], sheets: 0 },
		});
		expect(canDeleteCommonGoalSet(set, [])).toEqual({
			ok: false,
			error: { kind: "setInUse", grades: [], sheets: 4 },
		});
	});
});
