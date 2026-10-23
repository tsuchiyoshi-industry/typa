// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { showToast } from "../feedback";
import SmtpSettings from "./SmtpSettings";

vi.mock("../feedback", () => ({ showToast: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function setup() {
	const controller = {
		load: vi.fn().mockResolvedValue({
			host: "smtp.example.jp",
			port: 465,
			user: "sender@example.jp",
			passwordSet: true,
		}),
		save: vi.fn().mockResolvedValue({ success: true, message: "保存しました" }),
		sendTest: vi.fn().mockResolvedValue({ success: true, message: "送信しました" }),
	};
	const view = render(() => <SmtpSettings controller={controller} />);
	return { ...view, controller };
}

it("sends the entered address and selected pattern without saving either", async () => {
	const view = setup();
	const to = await view.findByRole("textbox", { name: "宛先メールアドレス" });
	fireEvent.input(to, { target: { value: "test@example.jp" } });
	const patterns = view.getByRole("combobox", { name: "通知パターン" });
	expect(view.getAllByRole("option")).toHaveLength(2);
	fireEvent.change(patterns, { target: { value: "first_evaluated" } });
	fireEvent.click(view.getByRole("button", { name: "テストメールを送信する" }));
	await waitFor(() =>
		expect(view.controller.sendTest).toHaveBeenCalledExactlyOnceWith({
			to: "test@example.jp",
			templateId: "first_evaluated",
		}),
	);
	expect(view.controller.save).not.toHaveBeenCalled();
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "送信しました"));
	cleanup();
	const next = setup();
	expect(
		((await next.findByRole("textbox", { name: "宛先メールアドレス" })) as HTMLInputElement).value,
	).toBe("");
});

it("requires saved SMTP settings and does not test a changed, unsaved configuration", async () => {
	const view = setup();
	const host = await view.findByRole("textbox", { name: "SMTP ホスト" });
	const send = view.getByRole("button", { name: "テストメールを送信する" }) as HTMLButtonElement;
	expect(send.disabled).toBe(false);
	fireEvent.input(host, { target: { value: "other.example.jp" } });
	expect(send.disabled).toBe(true);
	expect(view.getByText("通知メールの設定を保存してから送信してください。")).toBeTruthy();
	fireEvent.input(host, { target: { value: "smtp.example.jp" } });
	expect(send.disabled).toBe(false);
});

it("blocks duplicate requests, preserves test input on failure, and permits a retry", async () => {
	const view = setup();
	let finish!: (value: { success: boolean; message: string }) => void;
	view.controller.sendTest.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const to = (await view.findByRole("textbox", { name: "宛先メールアドレス" })) as HTMLInputElement;
	fireEvent.input(to, { target: { value: "test@example.jp" } });
	fireEvent.click(view.getByRole("button", { name: "テストメールを送信する" }));
	expect(to.disabled).toBe(true);
	expect(
		(view.getByRole("button", { name: "通知メールの設定を保存する" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(view.getByRole("button", { name: "送信中..." }));
	expect(view.controller.sendTest).toHaveBeenCalledOnce();
	finish({ success: false, message: "送信できませんでした" });
	await waitFor(() => expect(to.disabled).toBe(false));
	expect(to.value).toBe("test@example.jp");
	expect(showToast).toHaveBeenCalledWith("error", "送信できませんでした");
	fireEvent.click(view.getByRole("button", { name: "テストメールを送信する" }));
	await waitFor(() => expect(view.controller.sendTest).toHaveBeenCalledTimes(2));
	expect(view.controller.save).not.toHaveBeenCalled();
});

it("unlocks the test form after a communication error", async () => {
	const view = setup();
	view.controller.sendTest.mockRejectedValueOnce(new Error("offline"));
	const to = (await view.findByRole("textbox", { name: "宛先メールアドレス" })) as HTMLInputElement;
	fireEvent.input(to, { target: { value: "test@example.jp" } });
	fireEvent.click(view.getByRole("button", { name: "テストメールを送信する" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("時間をおいて")),
	);
	expect(to.disabled).toBe(false);
});
