import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EvaluationNotificationRecipientRepository } from "../../domain/repositories/EvaluationNotificationRecipientRepository";
import { TauriEmailNotificationRepository } from "./TauriEmailNotificationRepository";

const notification = {
	sheetId: 100,
	employeeName: "社員",
	employeeNo: "E001",
	periodName: "2026上期",
};
function setup(
	primary: string | null = "first@example.jp",
	secondary: string | null = "second@example.jp",
) {
	const recipients = {
		findFinalizedSheetRecipients: vi
			.fn<EvaluationNotificationRecipientRepository["findFinalizedSheetRecipients"]>()
			.mockResolvedValue([
				{ role: "primary", employeeId: 2, email: primary },
				{ role: "secondary", employeeId: 3, email: secondary },
			]),
	};
	const ipc = vi.fn<Parameters<typeof mockIPC>[0]>(() => undefined);
	mockIPC(ipc);
	return { repository: new TauriEmailNotificationRepository(recipients), recipients, ipc };
}
beforeEach(() => {
	vi.stubGlobal("window", {});
	vi.stubEnv("VITE_SMTP_HOST", "smtp.example.jp");
	vi.stubEnv("VITE_SMTP_PORT", "587");
	vi.stubEnv("VITE_SMTP_USER", "support@example.jp");
	vi.stubEnv("VITE_SMTP_PASSWORD", "synthetic-test-password");
	vi.stubEnv("VITE_SHEET_FINALIZED_NOTIFY_TO", "old-fixed@example.jp");
});
afterEach(() => {
	clearMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
it("sends separately to both registered evaluators and ignores the obsolete fixed address", async () => {
	const { repository, recipients, ipc } = setup();
	await repository.notifySheetFinalized(notification);
	expect(recipients.findFinalizedSheetRecipients).toHaveBeenCalledWith(100);
	expect(ipc).toHaveBeenCalledTimes(2);
	expect(
		ipc.mock.calls.map(([, args]) => (args as { request: { to: string } }).request.to),
	).toEqual(["first@example.jp", "second@example.jp"]);
	expect(ipc.mock.calls[0]).toEqual([
		"send_email",
		{
			request: expect.objectContaining({
				to: "first@example.jp",
				smtpPassword: "synthetic-test-password",
				body: expect.stringContaining("シートID: 100"),
			}),
		},
	]);
});
it("deduplicates trimmed addresses case-insensitively", async () => {
	const { repository, ipc } = setup(" SAME@example.jp ", "same@example.jp");
	await repository.notifySheetFinalized(notification);
	expect(ipc).toHaveBeenCalledTimes(1);
});
it.each([null, "", "bad\r\nBcc: other@example.jp"])(
	"reports a missing/invalid primary email while still notifying secondary (%s)",
	async (email) => {
		const { repository, ipc } = setup(email);
		await expect(repository.notifySheetFinalized(notification)).rejects.toThrow("一次評価者");
		expect(ipc).toHaveBeenCalledTimes(1);
	},
);
it("does not send when neither evaluator has a verified email", async () => {
	const { repository, ipc } = setup(null, null);
	await expect(repository.notifySheetFinalized(notification)).rejects.toThrow("認証済み登録メール");
	expect(ipc).not.toHaveBeenCalled();
});
it("does not send when recipient lookup fails", async () => {
	const { repository, recipients, ipc } = setup();
	recipients.findFinalizedSheetRecipients.mockRejectedValue(new Error("access denied"));
	await expect(repository.notifySheetFinalized(notification)).rejects.toThrow("access denied");
	expect(ipc).not.toHaveBeenCalled();
});
it("still attempts secondary delivery when primary SMTP delivery fails", async () => {
	const { repository, ipc } = setup();
	ipc.mockImplementation((_command, args) => {
		if ((args as { request: { to: string } }).request.to === "first@example.jp") {
			throw new Error("SMTP failed");
		}
	});
	await expect(repository.notifySheetFinalized(notification)).rejects.toThrow("送信失敗1件");
	expect(ipc).toHaveBeenCalledTimes(2);
});
