import { expect, it, vi } from "vitest";
import { masterRepository, output, profile } from "../../test/fixtures";
import {
	SendTestNotificationInteractor,
	type SendTestNotificationRequest,
	type SendTestNotificationResponse,
} from "./SendTestNotificationInteractor";

const request = { to: " test@example.jp ", templateId: "submitted" };
function setup(role: string | null = "Admin") {
	const gateway = { sendTest: vi.fn().mockResolvedValue(undefined) };
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(role ? profile(role, 1) : null);
	const useCase = new SendTestNotificationInteractor(gateway, employees);
	const out = output<SendTestNotificationResponse>();
	return { gateway, employees, out, useCase };
}

it.each(["submitted", "first_evaluated"])("sends %s to the entered address", async (templateId) => {
	const { gateway, out, useCase } = setup();
	await useCase.execute({ ...request, templateId }, out);
	expect(gateway.sendTest).toHaveBeenCalledExactlyOnceWith("test@example.jp", templateId);
	expect(out.present).toHaveBeenCalledWith({
		success: true,
		message: expect.stringContaining("test@example.jp"),
	});
});

it.each(["Reviewer", "Employee", null])("denies %s without sending", async (role) => {
	const { gateway, out, useCase } = setup(role);
	await useCase.execute(request, out);
	expect(gateway.sendTest).not.toHaveBeenCalled();
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
	expect(gateway.sendTest).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({
		success: false,
		message: expect.stringContaining("Admin"),
	});
});

it.each<Partial<SendTestNotificationRequest>>([
	{ to: "" },
	{ to: "a@example.jp, b@example.jp" },
	{ to: "a@example.jp\r\nBcc: b@example.jp" },
	{ templateId: "finalized" },
	{ templateId: "__proto__" },
])("rejects invalid input %j", async (change) => {
	const { gateway, out, useCase } = setup();
	await useCase.execute({ ...request, ...change }, out);
	expect(gateway.sendTest).not.toHaveBeenCalled();
	expect(out.present).toHaveBeenCalledWith({ success: false, message: expect.any(String) });
});
