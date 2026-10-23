import { beforeEach, expect, it, vi } from "vitest";
import { supabase } from "../db/supabase";
import { SupabaseEmailNotificationRepository } from "./SupabaseEmailNotificationRepository";

vi.mock("../db/supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
beforeEach(() => vi.mocked(supabase.functions.invoke).mockReset());

it("sends a test request containing only the address and template selection", async () => {
	vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true }, error: null });
	await new SupabaseEmailNotificationRepository().sendTest("test@example.jp", "first_evaluated");
	expect(supabase.functions.invoke).toHaveBeenCalledExactlyOnceWith("notify-sheet", {
		body: { mode: "test", to: "test@example.jp", templateId: "first_evaluated" },
	});
});

it("reports refusals from the function and rejects incomplete responses", async () => {
	const repository = new SupabaseEmailNotificationRepository();
	vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
		data: null,
		error: Object.assign(new Error("function error"), {
			context: new Response(JSON.stringify({ error: "送信テストは Admin のみ利用できます。" })),
		}),
	});
	await expect(repository.sendTest("test@example.jp", "submitted")).rejects.toThrow("Admin");
	vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: {}, error: null });
	await expect(repository.sendTest("test@example.jp", "submitted")).rejects.toThrow(
		"テストメールを送信できませんでした",
	);
});
