// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountController } from "../controllers/AccountController";
import LoginView from "./LoginView";

afterEach(cleanup);
function setup() {
	const controller = {
		requiredEmailSuffix: vi.fn().mockResolvedValue("@example.jp"),
		signIn: vi.fn().mockResolvedValue("account_disabled"),
		sendVerificationCode: vi.fn().mockResolvedValue(true),
		register: vi.fn().mockResolvedValue("invalid_invitation"),
		signOut: vi.fn().mockResolvedValue(undefined),
	};
	render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => <LoginView controller={controller as unknown as AccountController} />}
			/>
		</MemoryRouter>
	));
	return controller;
}
it.each([
	["invalid_credentials", /社員番号またはパスワードが正しくありません/],
	["account_disabled", /利用が停止されています/],
	["unavailable", /確かめられませんでした。通信状況を確かめて/],
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
