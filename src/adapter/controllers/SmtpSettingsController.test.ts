import { expect, it, vi } from "vitest";
import { UpdateNotificationChannelInteractor } from "../../application/usecases/UpdateNotificationChannelInteractor";
import { UpdateSmtpSettingsInteractor } from "../../application/usecases/UpdateSmtpSettingsInteractor";
import { masterRepository, profile } from "../../test/fixtures";
import { SmtpSettingsController } from "./SmtpSettingsController";

const request = {
	host: "smtp.example.jp",
	port: 465,
	user: "sender@example.jp",
	password: "",
	to: "test@example.jp",
	templateId: "submitted",
};
function setup() {
	const gateway = { saveAfterTestMail: vi.fn().mockResolvedValue(undefined) };
	const settings = {
		findSmtpSummary: vi.fn().mockResolvedValue(null),
		saveNotificationChannel: vi.fn().mockResolvedValue(true),
	};
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile("Admin", 1));
	const controller = new SmtpSettingsController(
		settings,
		new UpdateSmtpSettingsInteractor(gateway, employees),
		new UpdateNotificationChannelInteractor(settings, employees),
	);
	return { gateway, settings, controller };
}

it("shows why the settings were not saved, as the server explained it", async () => {
	const { gateway, controller } = setup();
	gateway.saveAfterTestMail.mockRejectedValueOnce(
		new Error("テストメールを送信できませんでした。（詳細: ESOCKET: HandshakeFailure）"),
	);
	expect(await controller.save(request)).toEqual({
		success: false,
		message: "テストメールを送信できませんでした。（詳細: ESOCKET: HandshakeFailure）",
	});
});

it("switches the notification channel and reports the result", async () => {
	const { settings, controller } = setup();
	expect(await controller.chooseChannel("email")).toEqual({
		success: true,
		message: expect.stringContaining("メール"),
	});
	expect(settings.saveNotificationChannel).toHaveBeenCalledWith("email");
	settings.saveNotificationChannel.mockRejectedValueOnce(new Error("offline"));
	expect(await controller.chooseChannel("in_app")).toEqual({
		success: false,
		message: expect.stringContaining("変更できませんでした"),
	});
});
