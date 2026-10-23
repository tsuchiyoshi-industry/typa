import { expect, type Locator, type Page } from "@playwright/test";

export const E2E_PORT = 1430;
export const PASSWORD = "E2ePassw0rd!";
/** release-fixture.sql の社員。001 が Admin、002・003 が評価者、004 の一次は 002・二次は 003。 */
export const ADMIN = "RELEASE001";

export async function openPreRegistration(page: Page) {
	await page.getByRole("button", { name: "ユーザーメニュー" }).click();
	await page.getByRole("link", { name: "導入処理", exact: true }).click();
	await page.getByRole("link", { name: /初期ユーザ/ }).click();
	await expect(page).toHaveURL(/\/setup\/employees$/);
	await expect(page.getByRole("heading", { name: "初期ユーザ", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "仮登録する", exact: true })).toBeEnabled();
}

export async function fillPreRegistration(page: Page, employeeNo: string, name: string) {
	await page.getByLabel("社員番号", { exact: true }).fill(employeeNo);
	await page.getByLabel("氏名", { exact: true }).fill(name);
	await page.getByRole("combobox", { name: "キャリアコース", exact: true }).selectOption("総合職");
	await page
		.getByRole("combobox", { name: "等級", exact: true })
		.selectOption({ label: "Release verification" });
}

export async function signIn(page: Page, employeeNo: string, password = PASSWORD) {
	await page.goto("/login");
	await page.getByLabel("社員番号").fill(employeeNo);
	await page.getByLabel("パスワード", { exact: true }).fill(password);
	await page.getByRole("button", { name: "ログイン" }).click();
}

export async function signOut(page: Page) {
	await page.getByRole("button", { name: "ユーザーメニュー" }).click();
	await page.getByRole("button", { name: "ログアウト" }).click();
	await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
}

/**
 * release-fixture.sql の社員 n としてログインし、画面を通さずに REST を直接たたく。
 * 画面で伏せているだけでなく、サーバーが返さないことを確かめるのに使う。
 */
export async function restAs(n: number) {
	const base = process.env.E2E_API_URL as string;
	const apikey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
	const login = await fetch(`${base}/auth/v1/token?grant_type=password`, {
		method: "POST",
		headers: { apikey, "Content-Type": "application/json" },
		body: JSON.stringify({ email: `typa-release00${n}@release.example`, password: PASSWORD }),
	});
	const { access_token } = (await login.json()) as { access_token: string };
	expect(access_token).toBeTruthy();
	return (path: string, body?: unknown) =>
		fetch(`${base}/rest/v1/${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				apikey,
				Authorization: `Bearer ${access_token}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
}

/**
 * 宛先あての有効な認証コード。ローカルのメール本文はリンク形式でコードを含まないため、
 * リリース検証と同じく管理 API で発行し直したコードを、利用者が打ち込む値として使う。
 */
export async function issueOtp(email: string): Promise<string> {
	const service = process.env.E2E_SERVICE_KEY as string;
	const response = await fetch(`${process.env.E2E_API_URL}/auth/v1/admin/generate_link`, {
		method: "POST",
		headers: {
			apikey: service,
			Authorization: `Bearer ${service}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ type: "magiclink", email }),
	});
	const body = (await response.json()) as { email_otp?: string };
	if (!body.email_otp) {
		throw new Error(`Could not issue a code: ${JSON.stringify(body)}`);
	}
	return body.email_otp as string;
}

/**
 * 評価シートの窓を閉じる。確定の直後は保存が済むまで閉じず「保存が完了するまでお待ちください」と出るので、
 * 閉じたことを確かめ、閉じていなければ押し直す。
 */
export async function closeSheetWindow(window: Locator) {
	await expect(async () => {
		if (await window.isVisible()) {
			await window.getByRole("button", { name: "閉じる" }).click({ timeout: 2_000 });
		}
		await expect(window).toBeHidden({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
}
