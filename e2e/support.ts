import { expect, type Page } from "@playwright/test";

export const E2E_PORT = 1430;
export const PASSWORD = "E2ePassw0rd!";
/** release-fixture.sql の社員。001 が Admin、002・003 が評価者、004 の一次は 002・二次は 003。 */
export const ADMIN = "RELEASE001";

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
