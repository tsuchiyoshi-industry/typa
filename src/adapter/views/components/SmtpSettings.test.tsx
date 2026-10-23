// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { showToast } from "../feedback";
import { formatDateTime } from "../format";
import SmtpSettings from "./SmtpSettings";

vi.mock("../feedback", () => ({ showToast: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const stored = {
	host: "smtp.example.jp",
	port: 465,
	user: "sender@example.jp",
	passwordSet: true,
	verifiedAt: null as string | null,
	channel: "in_app",
};
function setup(summary: typeof stored | null = stored) {
	const controller = {
		load: vi.fn().mockResolvedValue(summary),
		save: vi.fn().mockResolvedValue({ success: true, message: "保存しました" }),
		chooseChannel: vi.fn().mockResolvedValue({ success: true, message: "変更しました" }),
	};
	const view = render(() => <SmtpSettings controller={controller} />);
	return { ...view, controller };
}

it("sends a test mail with the entered settings and saves them in one step", async () => {
	const view = setup();
	const host = await view.findByRole("textbox", { name: "SMTP ホスト" });
	fireEvent.input(host, { target: { value: "new.example.jp" } });
	fireEvent.input(view.getByLabelText("パスワード"), { target: { value: "secret" } });
	fireEvent.input(view.getByRole("textbox", { name: "宛先メールアドレス" }), {
		target: { value: "test@example.jp" },
	});
	expect(view.getAllByRole("option")).toHaveLength(2);
	fireEvent.change(view.getByRole("combobox", { name: "通知パターン" }), {
		target: { value: "first_evaluated" },
	});
	fireEvent.click(view.getByRole("button", { name: "テストメールを送って保存する" }));
	await waitFor(() =>
		expect(view.controller.save).toHaveBeenCalledExactlyOnceWith({
			host: "new.example.jp",
			port: 465,
			user: "sender@example.jp",
			password: "secret",
			to: "test@example.jp",
			templateId: "first_evaluated",
		}),
	);
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("success", "保存しました"));
	// 保存した設定を読み直す。宛先は保存しない
	await waitFor(() => expect(view.controller.load).toHaveBeenCalledTimes(2));
	cleanup();
	const next = setup();
	expect(
		((await next.findByRole("textbox", { name: "宛先メールアドレス" })) as HTMLInputElement).value,
	).toBe("");
});

it("blocks a second request, keeps everything entered when the test mail fails, and permits a retry", async () => {
	const view = setup();
	let finish!: (value: { success: boolean; message: string }) => void;
	view.controller.save.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const password = (await view.findByLabelText("パスワード")) as HTMLInputElement;
	const to = view.getByRole("textbox", { name: "宛先メールアドレス" }) as HTMLInputElement;
	fireEvent.input(password, { target: { value: "secret" } });
	fireEvent.input(to, { target: { value: "test@example.jp" } });
	fireEvent.click(view.getByRole("button", { name: "テストメールを送って保存する" }));
	expect(to.disabled).toBe(true);
	expect(password.disabled).toBe(true);
	fireEvent.click(view.getByRole("button", { name: "送信中..." }));
	expect(view.controller.save).toHaveBeenCalledOnce();
	finish({ success: false, message: "テストメールを送信できませんでした。（詳細: ESOCKET）" });
	await waitFor(() => expect(to.disabled).toBe(false));
	expect(showToast).toHaveBeenCalledWith(
		"error",
		"テストメールを送信できませんでした。（詳細: ESOCKET）",
	);
	expect(to.value).toBe("test@example.jp");
	expect(password.value).toBe("secret");
	expect(view.controller.load).toHaveBeenCalledOnce();
	fireEvent.click(view.getByRole("button", { name: "テストメールを送って保存する" }));
	await waitFor(() => expect(view.controller.save).toHaveBeenCalledTimes(2));
});

it("unlocks the form after a communication error", async () => {
	const view = setup();
	view.controller.save.mockRejectedValueOnce(new Error("offline"));
	const to = (await view.findByRole("textbox", { name: "宛先メールアドレス" })) as HTMLInputElement;
	fireEvent.input(to, { target: { value: "test@example.jp" } });
	fireEvent.click(view.getByRole("button", { name: "テストメールを送って保存する" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("時間をおいて")),
	);
	expect(to.disabled).toBe(false);
	expect(to.value).toBe("test@example.jp");
});

it("requires a password until one is stored, and never shows the stored one", async () => {
	const view = setup();
	const password = (await view.findByLabelText("パスワード")) as HTMLInputElement;
	expect(password.value).toBe("");
	expect(password.required).toBe(false);
	cleanup();
	const fresh = setup({ ...stored, host: "", user: "", passwordSet: false });
	expect(((await fresh.findByLabelText("パスワード")) as HTMLInputElement).required).toBe(true);
});

it("notifies in the app by default and offers mail only after a test send passed", async () => {
	const view = setup();
	const inApp = (await view.findByRole("radio", { name: /アプリ内通知/ })) as HTMLInputElement;
	const mail = view.getByRole("radio", { name: /メール/ }) as HTMLInputElement;
	expect(inApp.checked).toBe(true);
	expect(mail.checked).toBe(false);
	expect(mail.disabled).toBe(true);
	expect(view.getByText(/送信テストに成功.*保存すると選べます/)).toBeTruthy();
	cleanup();
	const verified = setup({ ...stored, verifiedAt: "2026-10-23T05:00:00Z", channel: "email" });
	const verifiedMail = (await verified.findByRole("radio", {
		name: /メール/,
	})) as HTMLInputElement;
	expect(verifiedMail.disabled).toBe(false);
	expect(verifiedMail.checked).toBe(true);
	expect(
		verified.getByText(`送信テスト済み（${formatDateTime("2026-10-23T05:00:00Z")}）`, {
			exact: false,
		}),
	).toBeTruthy();
});

it("saves the chosen channel at once, and goes back to the saved one when that fails", async () => {
	const view = setup({ ...stored, verifiedAt: "2026-10-23T05:00:00Z" });
	const inApp = (await view.findByRole("radio", { name: /アプリ内通知/ })) as HTMLInputElement;
	const mail = view.getByRole("radio", { name: /メール/ }) as HTMLInputElement;
	let finish!: (value: { success: boolean; message: string }) => void;
	view.controller.chooseChannel.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	fireEvent.click(mail);
	expect(view.controller.chooseChannel).toHaveBeenCalledExactlyOnceWith("email");
	expect(inApp.disabled).toBe(true);
	finish({ success: true, message: "メールで知らせます" });
	await waitFor(() => expect(inApp.disabled).toBe(false));
	expect(showToast).toHaveBeenCalledWith("success", "メールで知らせます");
	expect(mail.checked).toBe(true);

	view.controller.chooseChannel.mockResolvedValueOnce({
		success: false,
		message: "変更できません",
	});
	fireEvent.click(inApp);
	await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", "変更できません"));
	expect(mail.checked).toBe(true);
	expect(inApp.checked).toBe(false);

	view.controller.chooseChannel.mockRejectedValueOnce(new Error("offline"));
	fireEvent.click(inApp);
	await waitFor(() =>
		expect(showToast).toHaveBeenLastCalledWith(
			"error",
			expect.stringContaining("変更できませんでした"),
		),
	);
	expect(mail.checked).toBe(true);
	expect(inApp.disabled).toBe(false);
});

it("offers mail as soon as the test send passed and the settings were saved", async () => {
	const view = setup();
	const mail = (await view.findByRole("radio", { name: /メール/ })) as HTMLInputElement;
	expect(mail.disabled).toBe(true);
	view.controller.load.mockResolvedValueOnce({ ...stored, verifiedAt: "2026-10-23T05:00:00Z" });
	fireEvent.input(view.getByRole("textbox", { name: "宛先メールアドレス" }), {
		target: { value: "test@example.jp" },
	});
	fireEvent.click(view.getByRole("button", { name: "テストメールを送って保存する" }));
	await waitFor(() => expect(mail.disabled).toBe(false));
	expect(mail.checked).toBe(false);
});
