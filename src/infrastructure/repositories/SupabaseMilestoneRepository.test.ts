import { expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
	const order = vi.fn();
	const eq = vi.fn(() => ({ order }));
	const select = vi.fn(() => ({ eq }));
	const from = vi.fn(() => ({ select }));
	return { from, select, eq, order };
});
vi.mock("../db/supabase", () => ({ supabase: { from: db.from } }));

import { SupabaseMilestoneRepository } from "./SupabaseMilestoneRepository";

it("propagates DB errors instead of representing them as empty objectives", async () => {
	const error = new Error("read denied");
	db.order.mockResolvedValueOnce({ data: null, error });
	await expect(new SupabaseMilestoneRepository().findBySheetId(100)).rejects.toThrow("read denied");
});
it("maps a successful empty response to an empty list", async () => {
	db.order.mockResolvedValueOnce({ data: null, error: null });
	await expect(new SupabaseMilestoneRepository().findBySheetId(100)).resolves.toEqual([]);
	expect(db.eq).toHaveBeenCalledWith("sheet_id", 100);
});
