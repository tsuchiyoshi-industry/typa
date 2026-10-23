import { expect, it, vi } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	UpdateSmtpSettingsInteractor,
	type UpdateSmtpSettingsRequest,
	type UpdateSmtpSettingsResponse,
} from "./UpdateSmtpSettingsInteractor";

const request: UpdateSmtpSettingsRequest = {
	host: " smtp.example.jp ",
	port: 465,
	user: " sender@example.jp ",
	password: "secret",
	to: " test@example.jp ",
	templateId: "first_evaluated",
};
function setup(role: string | null = "Admin") {
	const gateway = { saveAfterTestMail: vi.fn().mockResolvedValue(undefined) };
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(role ? profile(role, 1) : null);
	const useCase = new UpdateSmtpSettingsInteractor(gateway, employees);
	const out = output<UpdateSmtpSettingsResponse>();
	return { gateway, employees, out, useCase };
}

it("saves the settings only through a test mail to the entered address", async () => {
	const { gateway, out, useCase } = setup();
	await useCase.execute(request, out);
	expect(gateway.saveAfterTestMail).toHaveBeenCalledExactlyOnceWith(
		{ host: "smtp.example.jp", port: 465, user: "sender@example.jp", password: "secret" },
		"test@example.jp",
		"first_evaluated",
	);
	expect(out.present).toHaveBeenCalledWith({
		success: true,
		message: expect.stringMatching(
			/test@example\.jp.*sender@example\.jp|sender@example\.jp.*test@example\.jp/,
		),
	});
});

it.each(["Reviewer", "Employee", null])("denies %s without sending", async (role) => {
	const { gateway, out, useCase } = setup(role);
	await useCase.execute(request, out);
	expect(gateway.saveAfterTestMail).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({
		success: false,
		message: expect.stringContaining("Admin"),
	});
});

it("denies a suspended Admin", async () => {
	const { gateway, employees, out, useCase } = setup();
	employees.findCurrentEmployeeProfile.mockResolvedValue(
		Object.assign(profile("Admin"), { enabled: false }),
	);
	await useCase.execute(request, out);
	expect(gateway.saveAfterTestMail).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({
		success: false,
		message: expect.stringContaining("Admin"),
	});
});

it.each<[Partial<UpdateSmtpSettingsRequest>, string]>([
	[{ host: " " }, "ホスト"],
	[{ host: "smtp example.jp" }, "ホスト"],
	[{ port: 0 }, "ポート"],
	[{ port: 70000 }, "ポート"],
	[{ port: 58.7 }, "ポート"],
	[{ user: "not-an-address" }, "送信元"],
	[{ user: "a@example.jp, b@example.jp" }, "送信元"],
	[{ to: "" }, "宛先"],
	[{ to: "a@example.jp, b@example.jp" }, "宛先"],
	[{ to: "a@example.jp\r\nBcc: b@example.jp" }, "宛先"],
	[{ templateId: "finalized" }, "通知パターン"],
	[{ templateId: "__proto__" }, "通知パターン"],
])("rejects %j before sending", async (change, message) => {
	const { gateway, out, useCase } = setup();
	await useCase.execute({ ...request, ...change }, out);
	expect(gateway.saveAfterTestMail).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({
		success: false,
		message: expect.stringContaining(message),
	});
});
