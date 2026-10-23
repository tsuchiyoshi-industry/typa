import { expect, it, vi } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	UpdateNotificationChannelInteractor,
	type UpdateNotificationChannelResponse,
} from "./UpdateNotificationChannelInteractor";

function setup(role: string | null = "Admin") {
	const settings = { saveNotificationChannel: vi.fn().mockResolvedValue(true) };
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(role ? profile(role, 1) : null);
	const useCase = new UpdateNotificationChannelInteractor(settings, employees);
	const out = output<UpdateNotificationChannelResponse>();
	return { settings, employees, out, useCase };
}

it.each([
	["email", "メール"],
	["in_app", "アプリ内通知"],
])("lets an Admin choose %s", async (channel, label) => {
	const { settings, out, useCase } = setup();
	await useCase.execute({ channel }, out);
	expect(settings.saveNotificationChannel).toHaveBeenCalledExactlyOnceWith(channel);
	expect(out.present).toHaveBeenCalledWith({
		success: true,
		message: expect.stringContaining(label),
	});
});

it.each(["Reviewer", "Employee", null])("denies %s without saving", async (role) => {
	const { settings, out, useCase } = setup(role);
	await useCase.execute({ channel: "email" }, out);
	expect(settings.saveNotificationChannel).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({
		success: false,
		message: expect.stringContaining("Admin"),
	});
});

it("denies a suspended Admin", async () => {
	const { settings, employees, out, useCase } = setup();
	employees.findCurrentEmployeeProfile.mockResolvedValue(
		Object.assign(profile("Admin"), { enabled: false }),
	);
	await useCase.execute({ channel: "email" }, out);
	expect(settings.saveNotificationChannel).not.toHaveBeenCalled();
});

it.each(["both", "", "EMAIL", "__proto__"])("rejects %j without saving", async (channel) => {
	const { settings, out, useCase } = setup();
	await useCase.execute({ channel }, out);
	expect(settings.saveNotificationChannel).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({ success: false, message: expect.any(String) });
});

it("reports a change the database refused", async () => {
	const { settings, out, useCase } = setup();
	settings.saveNotificationChannel.mockResolvedValueOnce(false);
	await useCase.execute({ channel: "in_app" }, out);
	expect(out.present).toHaveBeenCalledWith({ success: false, message: expect.any(String) });
});

it("explains that mail needs SMTP settings that passed a test send", async () => {
	const { settings, out, useCase } = setup();
	settings.saveNotificationChannel.mockRejectedValueOnce(
		Object.assign(new Error("violates check constraint"), { code: "23514" }),
	);
	await useCase.execute({ channel: "email" }, out);
	expect(out.present).toHaveBeenCalledWith({
		success: false,
		message: expect.stringContaining("送信テスト"),
	});
});
