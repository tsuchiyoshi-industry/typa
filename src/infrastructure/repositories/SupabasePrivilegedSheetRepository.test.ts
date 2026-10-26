import { expect, it, vi } from "vitest";
import { PrivilegedSheetOperation } from "../../domain/entities/PrivilegedSheetOperation";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../db/supabase", () => ({ supabase: db }));

import { SupabasePrivilegedSheetRepository } from "./SupabasePrivilegedSheetRepository";

it.each(["delete", "changeStatus"])(
	"sends the complete %s operation through one audited RPC",
	async (action) => {
		const operation = PrivilegedSheetOperation.from({
			sheetId: 100,
			expectedStatus: "finalized",
			action,
			status: action === "delete" ? undefined : "draft",
			reason: "再現テスト",
		});
		if (!operation.ok) {
			throw new Error("invalid fixture");
		}
		db.rpc.mockResolvedValueOnce({ error: null });
		await new SupabasePrivilegedSheetRepository().execute(operation.value);
		expect(db.rpc).toHaveBeenCalledWith("privileged_sheet_operation", {
			p_sheet_id: 100,
			p_expected_status: "finalized",
			p_action: action,
			p_status: action === "delete" ? null : "draft",
			p_reason: "再現テスト",
		});
		db.rpc.mockRejectedValueOnce(new Error("offline"));
		await expect(new SupabasePrivilegedSheetRepository().execute(operation.value)).rejects.toThrow(
			"offline",
		);
		db.rpc.mockResolvedValueOnce({ error: new Error("audit denied") });
		await expect(new SupabasePrivilegedSheetRepository().execute(operation.value)).rejects.toThrow(
			"audit denied",
		);
	},
);
