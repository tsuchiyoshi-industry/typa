// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountController } from "../controllers/AccountController";
import LoginView from "./LoginView";

afterEach(cleanup);
function setup(onRegistrationLinked = vi.fn()) {
	const controller = {
		requiredEmailSuffix: vi.fn().mockResolvedValue("@example.jp"),
		signIn: vi.fn().mockResolvedValue("account_disabled"),
		sendVerificationCode: vi.fn().mockResolvedValue(true),
		register: vi.fn().mockResolvedValue("invalid_invitation"),
		signOut: vi.fn().mockResolvedValue(undefined),
		changeOwnPassword: vi.fn().mockResolvedValue("changed"),
	};
	render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<LoginView
						controller={controller as unknown as AccountController}
						onRegistrationLinked={onRegistrationLinked}
					/>
				)}
			/>
		</MemoryRouter>
	));
	return controller;
}
it.each([
	["invalid_credentials", /社員番号またはパスワードが正しくありません/],
	["account_disabled", /利用が停止されています/],
	["unavailable", /確かめられませんでした。通信状況を確かめて/],
	["unconfigured", /ログインの設定.*登録されていません。管理者に連絡してください/],
	["registration_incomplete", /登録が完了していません。新規登録をやり直してください/],
])("keeps normal login free of invitation codes and explains %s", async (status, message) => {
	const controller = setup();
	controller.signIn.mockResolvedValue(status);
	expect(screen.queryByLabelText("招待コード")).toBeNull();
	fireEvent.input(screen.getByLabelText("社員番号"), { target: { value: "E001" } });
	fireEvent.input(screen.getByLabelText("パスワード"), { target: { value: "password" } });
	fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
	await screen.findByText(message);
	expect(controller.signIn).toHaveBeenCalledWith("E001", "password");
	if (status === "registration_incomplete") {
		// 新規登録の1歩目へ移る
		expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
	} else {
		// 失敗したら、もう一度押せる
		expect((screen.getByRole("button", { name: "ログイン" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
	}
});
it("requires a personal invitation only at first registration and preserves OTP verification on a code typo", async () => {
	const controller = setup();
	fireEvent.click(screen.getByRole("button", { name: "新規登録" }));
	fireEvent.input(screen.getByLabelText("メールアドレス"), {
		target: { value: "shared@example.jp" },
	});
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "認証コードを受け取る" }) as HTMLButtonElement).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "認証コードを受け取る" }));
	const invite = await screen.findByLabelText("招待コード");
	fireEvent.input(screen.getByLabelText("認証コード"), { target: { value: "123456" } });
	fireEvent.input(screen.getByLabelText("社員番号"), { target: { value: "E001" } });
	fireEvent.input(screen.getByLabelText("パスワード"), { target: { value: "Passw0rd" } });
	fireEvent.input(screen.getByLabelText("パスワード（確認）"), { target: { value: "Passw0rd" } });
	expect((screen.getByRole("button", { name: "登録する" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	fireEvent.input(invite, { target: { value: "personal-code" } });
	fireEvent.click(screen.getByRole("button", { name: "登録する" }));
	await screen.findByText(/社員番号または招待コード/);
	expect(controller.register).toHaveBeenCalledWith(
		expect.objectContaining({
			employeeNo: "E001",
			invitationCode: "personal-code",
			verificationCode: "123456",
		}),
	);
	expect((screen.getByLabelText("認証コード") as HTMLInputElement).disabled).toBe(true);
});
it("sends the sign-up code to a mailbox at any domain, but only to something shaped like an address", async () => {
	const controller = setup();
	fireEvent.click(screen.getByRole("button", { name: "新規登録" }));
	const send = () =>
		screen.getByRole("button", { name: "認証コードを受け取る" }) as HTMLButtonElement;
	for (const typo of ["", "taro", "taro@", "@gmail.com", "taro @gmail.com"]) {
		fireEvent.input(screen.getByLabelText("メールアドレス"), { target: { value: typo } });
		expect(send().disabled).toBe(true);
	}
	// 会社ドメインでなくてよい(会社ドメインはログイン用の内部アドレスにだけ使う)
	fireEvent.input(screen.getByLabelText("メールアドレス"), {
		target: { value: " taro.yamada@gmail.com " },
	});
	await waitFor(() => expect(send().disabled).toBe(false));
	expect(screen.queryByText(/で終わる/)).toBeNull();
	fireEvent.click(send());
	await waitFor(() =>
		expect(controller.sendVerificationCode).toHaveBeenCalledWith("taro.yamada@gmail.com"),
	);
});

async function signInWithTemporaryPassword(onRegistrationLinked = vi.fn()) {
	const controller = setup(onRegistrationLinked);
	controller.signIn.mockResolvedValue("password_change_required");
	fireEvent.input(screen.getByLabelText("社員番号"), { target: { value: "E001" } });
	fireEvent.input(screen.getByLabelText("パスワード"), { target: { value: "TempPass1" } });
	fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
	await screen.findByRole("heading", { name: "新しいパスワードを決めてください" });
	return controller;
}
const fillNewPassword = (password: string, confirmation = password) => {
	fireEvent.input(screen.getByLabelText("新しいパスワード"), { target: { value: password } });
	fireEvent.input(screen.getByLabelText("新しいパスワード（確認）"), {
		target: { value: confirmation },
	});
};
const changeButton = () =>
	screen.getByRole("button", { name: "パスワードを変えて始める" }) as HTMLButtonElement;

it("asks for the employee's own password after a temporary one, without keeping the temporary one", async () => {
	const linked = vi.fn();
	const controller = await signInWithTemporaryPassword(linked);
	const input = screen.getByLabelText("新しいパスワード") as HTMLInputElement;
	expect(input.value).toBe("");
	expect(input.autocomplete).toBe("new-password");
	fillNewPassword("Mine1234");
	fireEvent.click(changeButton());
	await waitFor(() => expect(controller.changeOwnPassword).toHaveBeenCalledWith("Mine1234"));
	await waitFor(() => expect(linked).toHaveBeenCalledOnce());
});

it.each([
	["weak", "mine1234", "mine1234"],
	["mismatched", "Mine1234", "Mine12345"],
	["empty", "", ""],
])("does not submit a %s new password", async (_case, password, confirmation) => {
	const controller = await signInWithTemporaryPassword();
	fillNewPassword(password, confirmation);
	expect(changeButton().disabled).toBe(true);
	expect(controller.changeOwnPassword).not.toHaveBeenCalled();
});

it.each([
	["same_password", /仮のパスワードとは別の/],
	["weak_password", /大文字・小文字・数字/],
	["failed", /変更できませんでした/],
])("explains %s and lets the employee try again", async (status, message) => {
	const controller = await signInWithTemporaryPassword();
	controller.changeOwnPassword.mockResolvedValue(status);
	fillNewPassword("Mine1234");
	fireEvent.click(changeButton());
	await screen.findByText(message);
	expect(changeButton().disabled).toBe(false);
	expect(controller.signOut).not.toHaveBeenCalled();
});

it("returns to login, signing out, when the change cannot be confirmed or the employee cancels", async () => {
	let controller = await signInWithTemporaryPassword();
	controller.changeOwnPassword.mockResolvedValue("unavailable");
	fillNewPassword("Mine1234");
	fireEvent.click(changeButton());
	await screen.findByText(/新しいパスワードでもう一度ログインしてください/);
	expect(controller.signOut).toHaveBeenCalledOnce();
	expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
	cleanup();

	controller = await signInWithTemporaryPassword();
	fireEvent.click(screen.getByRole("button", { name: "ログアウトして戻る" }));
	await waitFor(() => expect(controller.signOut).toHaveBeenCalledOnce());
	expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
});
