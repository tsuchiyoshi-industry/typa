import { describe, expect, it } from "vitest";
import { createAccountSwitchGuard } from "./accountSwitch";

// 画面の状態(Presenter のビューモデルなど)は、ページを開いている間ずっと残る。
// 共有PCで前の人の評価を次の人に見せないよう、見せた人がサインアウトしたらページを読み直す
describe("account switch guard", () => {
	it("does not reload when the saved session is restored at startup", () => {
		const guard = createAccountSwitchGuard();
		expect(guard.mustReloadFor("a")).toBe(false);
	});

	it("does not reload at startup without a session (no reload loop)", () => {
		// 読み直した後のページも、セッションの無い状態から始まる
		const guard = createAccountSwitchGuard();
		expect(guard.signedOut()).toBe(false);
	});

	it("does not reload when the same session is confirmed again (token refresh)", () => {
		const guard = createAccountSwitchGuard();
		guard.mustReloadFor("a");
		expect(guard.mustReloadFor("a")).toBe(false);
	});

	it("reloads as soon as the person who was shown the screens signs out", () => {
		// 次の人がログインする前に捨てる。登録直後の社員番号の確認なども途中で消さない
		const guard = createAccountSwitchGuard();
		guard.mustReloadFor("a");
		expect(guard.signedOut()).toBe(true);
	});

	it("does not reload when a sign-in is refused before anything was shown", () => {
		// 利用停止などで断られたときのエラー表示を、読み直しで消さない
		const guard = createAccountSwitchGuard();
		expect(guard.signedOut()).toBe(false);
		expect(guard.signedOut()).toBe(false);
	});

	it("keeps asking for a reload when the sign-out is reported more than once", () => {
		const guard = createAccountSwitchGuard();
		guard.mustReloadFor("a");
		expect(guard.signedOut()).toBe(true);
		expect(guard.signedOut()).toBe(true);
	});

	it("reloads when the account changes without a sign-out in between", () => {
		// 別のタブで別の人がログインしたときなど
		const guard = createAccountSwitchGuard();
		guard.mustReloadFor("a");
		expect(guard.mustReloadFor("b")).toBe(true);
	});

	it("keeps asking for a reload until the page is actually reloaded", () => {
		const guard = createAccountSwitchGuard();
		guard.mustReloadFor("a");
		expect(guard.mustReloadFor("b")).toBe(true);
		expect(guard.mustReloadFor("c")).toBe(true);
		expect(guard.signedOut()).toBe(true);
		expect(guard.mustReloadFor("b")).toBe(true);
	});
});
