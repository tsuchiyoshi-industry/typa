import { beforeEach, expect, it, vi } from "vitest";
import {
	type CommonGoalSet,
	CommonGoalSetChange,
	GradeChange,
	type GradeEntry,
} from "../../domain/entities/GradeMaster";
import { expectOk } from "../../domain/Result";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: db }));

import { SupabaseGradeMasterRepository } from "./SupabaseGradeMasterRepository";

const grade: GradeEntry = { id: 3, name: "技能1級", itemSetId: 2, employeeCount: 1, sheetCount: 0 };
const set: CommonGoalSet = {
	id: 2,
	name: "一般",
	sheetCount: 4,
	items: [{ id: 10, title: "協調性", description: "説明", weight: 2 }],
};
const repository = () => new SupabaseGradeMasterRepository();
beforeEach(() => db.rpc.mockReset());

it("reads the grades and common goals in one call", async () => {
	db.rpc.mockResolvedValueOnce({ data: { grades: [grade], itemSets: [set] }, error: null });
	expect(await repository().load()).toEqual({ grades: [grade], itemSets: [set] });
	expect(db.rpc).toHaveBeenCalledWith("get_grade_master");
});

it.each([
	["no answer", null],
	["a grade without a name", { grades: [{ ...grade, name: 1 }], itemSets: [] }],
	["a set without items", { grades: [], itemSets: [{ ...set, items: null }] }],
	[
		"an item without a weight",
		{ grades: [], itemSets: [{ ...set, items: [{ id: 1, title: "x", description: "" }] }] },
	],
])("does not show %s as the master", async (_, data) => {
	db.rpc.mockResolvedValueOnce({ data, error: null });
	await expect(repository().load()).rejects.toThrow("読み込めませんでした");
});

it("sends a grade change with what was shown", async () => {
	db.rpc.mockResolvedValueOnce({ data: 3, error: null });
	const change = expectOk(
		GradeChange.from({ name: "技能Ⅰ級", itemSetId: 1, shown: grade }),
		String,
	);
	expect(await repository().saveGrade(change)).toBe(3);
	expect(db.rpc).toHaveBeenCalledWith("save_employee_grade", {
		p_id: 3,
		p_name: "技能Ⅰ級",
		p_item_set_id: 1,
		p_expected_name: "技能1級",
		p_expected_item_set_id: 2,
	});
});

it("sends a new grade with nothing shown", async () => {
	db.rpc.mockResolvedValueOnce({ data: 9, error: null });
	const change = expectOk(GradeChange.from({ name: "総合1級", itemSetId: 1, shown: null }), String);
	await repository().saveGrade(change);
	expect(db.rpc).toHaveBeenCalledWith(
		"save_employee_grade",
		expect.objectContaining({ p_id: null, p_expected_name: null, p_expected_item_set_id: null }),
	);
});

it("sends a set change with every item and what was shown, and returns the saved version", async () => {
	db.rpc.mockResolvedValueOnce({ data: 8, error: null });
	const items = [...set.items, { id: null, title: "品質", description: "", weight: 1 }];
	const change = expectOk(CommonGoalSetChange.from({ name: "一般", items, shown: set }), String);
	expect(await repository().saveCommonGoalSet(change)).toBe(8);
	expect(db.rpc).toHaveBeenCalledWith("save_common_evaluation_item_set", {
		p_id: 2,
		p_name: "一般",
		p_items: items,
		p_expected: { name: "一般", items: set.items },
	});
});

it("deletes with the name that was shown", async () => {
	db.rpc.mockResolvedValue({ data: null, error: null });
	await repository().deleteGrade(grade);
	await repository().deleteCommonGoalSet(set);
	expect(db.rpc).toHaveBeenCalledWith("delete_employee_grade", {
		p_id: 3,
		p_expected_name: "技能1級",
	});
	expect(db.rpc).toHaveBeenCalledWith("delete_common_evaluation_item_set", {
		p_id: 2,
		p_expected_name: "一般",
	});
});

it.each([
	["a refusal", { data: null, error: new Error("再読み込みしてから操作してください") }],
	["an unreadable answer", { data: "3", error: null }],
])("does not report a save as done on %s", async (_, answer) => {
	db.rpc.mockResolvedValueOnce(answer);
	const change = expectOk(GradeChange.from({ name: "総合1級", itemSetId: 1, shown: null }), String);
	await expect(repository().saveGrade(change)).rejects.toThrow();
});

it("does not report a delete as done when the database refuses it", async () => {
	db.rpc.mockResolvedValueOnce({ data: null, error: new Error("社員が 1 人います") });
	await expect(repository().deleteGrade(grade)).rejects.toThrow("社員が 1 人います");
});
