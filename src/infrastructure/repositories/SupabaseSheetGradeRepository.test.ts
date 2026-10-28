import { expect, it, vi } from "vitest";
import { SheetGradeChange } from "../../domain/entities/SheetGradeChange";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: db }));

import { SupabaseSheetGradeRepository } from "./SupabaseSheetGradeRepository";

const change = (expectedGradeId: number | null = 1) => {
	const result = SheetGradeChange.from({
		sheetId: 100,
		gradeId: 2,
		expectedGradeId,
		expectedStatus: "submitted",
		reason: "等級の登録誤り",
	});
	if (!result.ok) {
		throw new Error("invalid fixture");
	}
	return result.value;
};

it("sends the whole change through one audited RPC and returns how many entries it deleted", async () => {
	db.rpc.mockResolvedValueOnce({ data: 2, error: null });
	expect(await new SupabaseSheetGradeRepository().execute(change())).toBe(2);
	expect(db.rpc).toHaveBeenCalledWith("change_sheet_grade", {
		p_sheet_id: 100,
		p_grade_id: 2,
		p_expected_grade_id: 1,
		p_expected_status: "submitted",
		p_reason: "等級の登録誤り",
	});
});

it("sends a missing current grade as null", async () => {
	db.rpc.mockResolvedValueOnce({ data: 0, error: null });
	await new SupabaseSheetGradeRepository().execute(change(null));
	expect(db.rpc).toHaveBeenLastCalledWith(
		"change_sheet_grade",
		expect.objectContaining({ p_expected_grade_id: null }),
	);
});

it.each([
	["a refusal", { data: null, error: new Error("再読み込みしてから操作してください") }],
	["an unreadable answer", { data: "2", error: null }],
])("does not report success on %s", async (_, answer) => {
	db.rpc.mockResolvedValueOnce(answer);
	await expect(new SupabaseSheetGradeRepository().execute(change())).rejects.toThrow();
});

it("passes a network failure through", async () => {
	db.rpc.mockRejectedValueOnce(new Error("offline"));
	await expect(new SupabaseSheetGradeRepository().execute(change())).rejects.toThrow("offline");
});
