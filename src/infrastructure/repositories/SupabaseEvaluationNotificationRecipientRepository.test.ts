import { expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: db }));

import { SupabaseEvaluationNotificationRecipientRepository } from "./SupabaseEvaluationNotificationRecipientRepository";

const rows = [
	{ role: "primary", employee_id: 2, email: "first@example.jp" },
	{ role: "secondary", employee_id: 3, email: "second@example.jp" },
];
it("resolves verified emails via the authorized sheet RPC", async () => {
	db.rpc.mockResolvedValueOnce({ data: rows, error: null });
	expect(
		await new SupabaseEvaluationNotificationRecipientRepository().findFinalizedSheetRecipients(100),
	).toEqual([
		{ role: "primary", employeeId: 2, email: "first@example.jp" },
		{ role: "secondary", employeeId: 3, email: "second@example.jp" },
	]);
	expect(db.rpc).toHaveBeenCalledWith("get_finalized_sheet_notification_recipients", {
		p_sheet_id: 100,
	});
});
it("preserves missing/unregistered evaluator data for delivery warnings", async () => {
	db.rpc.mockResolvedValueOnce({
		data: [{ role: "primary", employee_id: null, email: null }, rows[1]],
		error: null,
	});
	expect(
		(
			await new SupabaseEvaluationNotificationRecipientRepository().findFinalizedSheetRecipients(
				100,
			)
		)[0],
	).toEqual({ role: "primary", employeeId: null, email: null });
});
it("propagates permission or missing-migration errors", async () => {
	db.rpc.mockResolvedValueOnce({ data: null, error: new Error("permission denied") });
	await expect(
		new SupabaseEvaluationNotificationRecipientRepository().findFinalizedSheetRecipients(100),
	).rejects.toThrow("permission denied");
});
it.each([
	null,
	[],
	[rows[0]],
	[rows[0], rows[0]],
	[{ ...rows[0], email: 123 }, rows[1]],
	[{ ...rows[0], role: "subject" }, rows[1]],
])("rejects malformed recipient data %j", async (data) => {
	db.rpc.mockResolvedValueOnce({ data, error: null });
	await expect(
		new SupabaseEvaluationNotificationRecipientRepository().findFinalizedSheetRecipients(100),
	).rejects.toThrow("不正");
});
