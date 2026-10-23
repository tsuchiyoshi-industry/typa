import { beforeEach, expect, it, vi } from "vitest";
import { supabase } from "../db/supabase";
import { SupabaseEmailNotificationRepository } from "./SupabaseEmailNotificationRepository";

vi.mock("../db/supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
beforeEach(() => vi.mocked(supabase.functions.invoke).mockReset());

it("asks the function to test the entered SMTP settings and save them", async () => {
	vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true }, error: null });
	const settings = {
		host: "smtp.example.jp",
		port: 465,
		user: "sender@example.jp",
		password: "secret",
	};
	await new SupabaseEmailNotificationRepository().saveAfterTestMail(
		settings,
		"test@example.jp",
		"first_evaluated",
	);
	expect(supabase.functions.invoke).toHaveBeenCalledExactlyOnceWith("notify-sheet", {
		body: { mode: "save", smtp: settings, to: "test@example.jp", templateId: "first_evaluated" },
	});
});

it("passes on why the settings were not saved, and never treats an unclear answer as saved", async () => {
	const repository = new SupabaseEmailNotificationRepository();
	const settings = { host: "smtp.example.jp", port: 465, user: "sender@example.jp", password: "" };
	vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
		data: null,
		error: Object.assign(new Error("function error"), {
			context: new Response(
				JSON.stringify({ error: "テストメールを送信できませんでした。（詳細: ESOCKET）" }),
			),
		}),
	});
	await expect(repository.saveAfterTestMail(settings, "t@example.jp", "submitted")).rejects.toThrow(
		"ESOCKET",
	);
	for (const data of [{}, null, { success: "true" }]) {
		vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data, error: null });
		await expect(
			repository.saveAfterTestMail(settings, "t@example.jp", "submitted"),
		).rejects.toThrow("保存できませんでした");
	}
});
