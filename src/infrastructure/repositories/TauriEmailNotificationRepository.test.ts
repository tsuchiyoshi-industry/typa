import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationDelivery } from "../../domain/repositories/EmailNotificationRepository";
import type { EvaluationNotificationRecipientRepository } from "../../domain/repositories/EvaluationNotificationRecipientRepository";
import type { WorkspaceSettingsRepository } from "../../domain/repositories/WorkspaceSettingsRepository";
import { TauriEmailNotificationRepository } from "./TauriEmailNotificationRepository";

const notification = {
	sheetId: 100,
	employeeName: "社員",
	employeeNo: "E001",
	periodName: "2026上期",
	primaryEvaluatorName: "一次 太郎",
	secondaryEvaluatorName: "二次 花子",
};
const smtp = {
	host: "smtp.example.jp",
	port: 587,
	user: "support@example.jp",
	password: "synthetic-test-password",
};
function setup(
	primary: string | null = "first@example.jp",
	secondary: string | null = "second@example.jp",
) {
	const recipients = {
		findSubmittedSheetRecipient: vi
			.fn<EvaluationNotificationRecipientRepository["findSubmittedSheetRecipient"]>()
			.mockResolvedValue(primary),
		findFirstEvaluatedSheetRecipient: vi
			.fn<EvaluationNotificationRecipientRepository["findFirstEvaluatedSheetRecipient"]>()
			.mockResolvedValue(secondary),
		findFinalizedSheetRecipients: vi
			.fn<EvaluationNotificationRecipientRepository["findFinalizedSheetRecipients"]>()
			.mockResolvedValue([
				{ role: "primary", employeeId: 2, email: primary },
				{ role: "secondary", employeeId: 3, email: secondary },
			]),
	};
	const settings = {
		findNotificationSmtp: vi
			.fn<WorkspaceSettingsRepository["findNotificationSmtp"]>()
			.mockResolvedValue(smtp),
	};
	const ipc = vi.fn<Parameters<typeof mockIPC>[0]>(() => undefined);
	mockIPC(ipc);
	const report = vi.fn<(delivery: NotificationDelivery) => void>();
	return {
		repository: new TauriEmailNotificationRepository(recipients, settings),
		recipients,
		settings,
		ipc,
		report,
	};
}
beforeEach(() => {
	vi.stubGlobal("window", {});
});
afterEach(() => {
	clearMocks();
	vi.unstubAllGlobals();
});
it("sends separately to both evaluators with the SMTP account stored in the workspace settings", async () => {
	const { repository, recipients, ipc, report } = setup();
	await repository.notifySheetFinalized(notification, report);
	expect(recipients.findFinalizedSheetRecipients).toHaveBeenCalledWith(100);
	expect(ipc).toHaveBeenCalledTimes(2);
	expect(ipc.mock.calls[0]).toEqual([
		"send_email",
		{
			request: expect.objectContaining({
				to: "first@example.jp",
				smtpHost: "smtp.example.jp",
				smtpPort: 587,
				smtpUser: "support@example.jp",
				smtpPassword: "synthetic-test-password",
				body: expect.stringContaining("シートID: 100"),
			}),
		},
	]);
	// 送れた宛先を、評価者の名前でひとりずつ知らせる
	expect(report.mock.calls.map(([delivery]) => delivery)).toEqual([
		{ recipient: "一次 太郎（一次評価者）" },
		{ recipient: "二次 花子（二次評価者）" },
	]);
});
it("deduplicates trimmed addresses case-insensitively and reports both evaluators at once", async () => {
	const { repository, ipc, report } = setup(" SAME@example.jp ", "same@example.jp");
	await repository.notifySheetFinalized(notification, report);
	expect(ipc).toHaveBeenCalledTimes(1);
	expect(report).toHaveBeenCalledExactlyOnceWith({
		recipient: "一次 太郎（一次評価者）・二次 花子（二次評価者）",
	});
});
it.each([null, "", "bad\r\nBcc: other@example.jp"])(
	"reports a missing/invalid primary email while still notifying secondary (%s)",
	async (email) => {
		const { repository, ipc, report } = setup(email);
		await repository.notifySheetFinalized(notification, report);
		expect(ipc).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith({
			recipient: "一次 太郎（一次評価者）",
			error: expect.stringContaining("登録メール"),
		});
		expect(report).toHaveBeenCalledWith({ recipient: "二次 花子（二次評価者）" });
	},
);
it("notifies only the primary evaluator when there is no secondary evaluator", async () => {
	const { repository, recipients, ipc, report } = setup();
	recipients.findFinalizedSheetRecipients.mockResolvedValue([
		{ role: "primary", employeeId: 2, email: "first@example.jp" },
		{ role: "secondary", employeeId: null, email: null },
	]);
	await repository.notifySheetFinalized(notification, report);
	expect(ipc).toHaveBeenCalledTimes(1);
	expect(report).toHaveBeenCalledExactlyOnceWith({ recipient: "一次 太郎（一次評価者）" });
});
it("does not send when recipient lookup fails", async () => {
	const { repository, recipients, ipc, report } = setup();
	recipients.findFinalizedSheetRecipients.mockRejectedValue(new Error("access denied"));
	await expect(repository.notifySheetFinalized(notification, report)).rejects.toThrow(
		"access denied",
	);
	expect(ipc).not.toHaveBeenCalled();
});
it.each([
	["unreadable", () => Promise.reject(new Error("permission denied")), "permission denied"],
	["not registered yet", () => Promise.resolve({ ...smtp, host: "" }), "設定画面"],
] as const)("does not send when the SMTP settings are %s", async (_label, find, message) => {
	const { repository, settings, ipc, report } = setup();
	settings.findNotificationSmtp.mockImplementation(find);
	await expect(repository.notifySheetFinalized(notification, report)).rejects.toThrow(message);
	await expect(repository.notifyFirstEvaluationConfirmed(notification, report)).rejects.toThrow(
		message,
	);
	expect(ipc).not.toHaveBeenCalled();
});
it("reports the SMTP error of one evaluator and still delivers to the other", async () => {
	const { repository, ipc, report } = setup();
	ipc.mockImplementation((_command, args) => {
		if ((args as { request: { to: string } }).request.to === "first@example.jp") {
			// Tauri コマンドの Err(String) は、文字列のまま reject される
			throw "メール送信に失敗しました: 535 authentication failed";
		}
	});
	await repository.notifySheetFinalized(notification, report);
	expect(ipc).toHaveBeenCalledTimes(2);
	expect(report).toHaveBeenCalledWith({
		recipient: "一次 太郎（一次評価者）",
		error: "メール送信に失敗しました: 535 authentication failed",
	});
	expect(report).toHaveBeenCalledWith({ recipient: "二次 花子（二次評価者）" });
});
it("asks the primary evaluator to start once the sheet is submitted", async () => {
	const { repository, recipients, ipc, report } = setup();
	await repository.notifySheetSubmitted(notification, report);
	expect(recipients.findSubmittedSheetRecipient).toHaveBeenCalledWith(100);
	expect(ipc.mock.calls[0]).toEqual([
		"send_email",
		{
			request: expect.objectContaining({
				to: "first@example.jp",
				subject: expect.stringContaining("一次評価のお願い"),
			}),
		},
	]);
	expect(report).toHaveBeenCalledExactlyOnceWith({ recipient: "一次 太郎（一次評価者）" });
});
it("reports a primary evaluator without an address instead of sending the submission notice", async () => {
	const { repository, ipc, report } = setup(null);
	await repository.notifySheetSubmitted(notification, report);
	expect(ipc).not.toHaveBeenCalled();
	expect(report).toHaveBeenCalledExactlyOnceWith({
		recipient: "一次 太郎（一次評価者）",
		error: expect.stringContaining("登録メール"),
	});
});
it("asks only the secondary evaluator to start once the primary evaluation is confirmed", async () => {
	const { repository, recipients, ipc, report } = setup();
	await repository.notifyFirstEvaluationConfirmed(notification, report);
	expect(recipients.findFirstEvaluatedSheetRecipient).toHaveBeenCalledWith(100);
	expect(ipc).toHaveBeenCalledTimes(1);
	expect(ipc.mock.calls[0]).toEqual([
		"send_email",
		{
			request: expect.objectContaining({
				to: "second@example.jp",
				subject: expect.stringContaining("二次評価のお願い"),
				body: expect.stringContaining("一次評価が確定しました"),
			}),
		},
	]);
	expect(report).toHaveBeenCalledExactlyOnceWith({ recipient: "二次 花子（二次評価者）" });
});
it.each([null, "", "not-an-address"])(
	"reports a secondary evaluator without a usable address %j instead of sending",
	async (address) => {
		const { repository, ipc, report } = setup("first@example.jp", address);
		await repository.notifyFirstEvaluationConfirmed(notification, report);
		expect(ipc).not.toHaveBeenCalled();
		expect(report).toHaveBeenCalledExactlyOnceWith({
			recipient: "二次 花子（二次評価者）",
			error: expect.stringContaining("登録メール"),
		});
	},
);
