import { expect, test } from "@playwright/test";
import { isolatedSql } from "../scripts/isolatedApi";
import { ADMIN, signIn } from "./support";

// 認証・設定読取は隔離した実 API を使う。送信だけ差し替え、外部へメールを送らない。
// Edge Function の権限と DB 非更新は verifyReleaseApi、SMTP の実通信は smtp.test.ts で確認する。
test("Admin selects either notification, retries failures, and does not persist the test recipient", async ({
	page,
}) => {
	const sql = (statement: string) => isolatedSql("typa_e2e", statement);
	const restore = sql(`select format(
		'update public.workspace_settings set smtp_host=%L,smtp_port=%L,smtp_user=%L,smtp_password=%L;',
		smtp_host,smtp_port,smtp_user,smtp_password) from public.workspace_settings`);
	const snapshot = () =>
		sql(`select json_build_object(
			'settings', (select row_to_json(s) from public.workspace_settings s),
			'deliveries', (select count(*) from public.sheet_notification_deliveries))`);
	try {
		sql(`update public.workspace_settings set smtp_host='smtp.example.jp',smtp_port=465,
			smtp_user='sender@example.jp',smtp_password='synthetic-test-password'`);
		const before = snapshot();
		const requests: unknown[] = [];
		let failNext = false;
		await page.route("**/functions/v1/notify-sheet", async (route) => {
			const headers = { "Access-Control-Allow-Origin": "*" };
			if (route.request().method() === "OPTIONS") {
				await route.fulfill({
					status: 204,
					headers: {
						...headers,
						"Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
						"Access-Control-Allow-Methods": "POST, OPTIONS",
					},
				});
				return;
			}
			requests.push(route.request().postDataJSON());
			await route.fulfill({
				status: failNext ? 503 : 200,
				headers,
				contentType: "application/json",
				body: JSON.stringify(
					failNext
						? {
								error:
									"テストメールを送信できませんでした。SMTP設定と接続先を確認してください。（詳細: EAUTH: Invalid login: 535-5.7.8 Username and Password not accepted. https://support.google.com/mail/?p=BadCredentials_synthetic_long_token_without_breaks）",
							}
						: { success: true },
				),
			});
			failNext = false;
		});
		await signIn(page, ADMIN);
		await page.getByRole("button", { name: "ユーザーメニュー" }).click();
		await page.getByRole("link", { name: "設定", exact: true }).click();
		const settings = page.getByRole("region", { name: "通知メール", exact: true });
		const to = settings.getByLabel("宛先メールアドレス", { exact: true });
		const pattern = settings.getByRole("combobox", { name: "通知パターン" });
		const send = settings.getByRole("button", { name: "テストメールを送信する", exact: true });
		await expect(send).toBeEnabled();
		await send.click();
		await expect(to).toBeFocused();
		expect(requests).toHaveLength(0);
		await to.fill("not-an-address");
		await send.click();
		await expect(to).toBeFocused();
		expect(requests).toHaveLength(0);
		await to.fill("test-recipient@example.jp");
		for (const [id, label] of [
			["submitted", "提出通知（一次評価の依頼）"],
			["first_evaluated", "一次評価確定通知（二次評価の依頼）"],
		]) {
			await pattern.selectOption({ label });
			await send.click();
			await expect(
				page.getByRole("status").filter({ hasText: "テストメールを送信しました" }).last(),
			).toBeVisible();
			await expect(send).toBeEnabled();
			expect(requests.at(-1)).toEqual({
				mode: "test",
				to: "test-recipient@example.jp",
				templateId: id,
			});
		}
		failNext = true;
		await send.click();
		await expect(
			page.getByRole("alert").filter({ hasText: "詳細: EAUTH: Invalid login: 535" }),
		).toBeVisible();
		await expect(send).toBeEnabled();
		await expect(to).toHaveValue("test-recipient@example.jp");
		await send.click();
		await expect.poll(() => requests.length).toBe(4);
		await expect(send).toBeEnabled();
		await settings.getByLabel("SMTP ホスト", { exact: true }).fill("changed.example.jp");
		await expect(send).toBeDisabled();
		await settings.getByLabel("SMTP ホスト", { exact: true }).fill("smtp.example.jp");
		await expect(send).toBeEnabled();
		expect(snapshot()).toBe(before);
		await settings.scrollIntoViewIfNeeded();
		await page.screenshot({ path: test.info().outputPath("smtp-desktop.png"), fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await settings.scrollIntoViewIfNeeded();
		await expect(send).toBeVisible();
		await page.screenshot({ path: test.info().outputPath("smtp-mobile.png"), fullPage: true });
		// CI の Linux フォントは幅が広い。字間を広げて、フォント次第ではみ出す箇所も手元で落とす
		for (const spacing of ["", "0.15em"]) {
			expect(
				await page.evaluate((spacing) => {
					document.body.style.letterSpacing = spacing;
					return document.documentElement.scrollWidth <= window.innerWidth;
				}, spacing),
			).toBe(true);
		}
		await page.reload();
		await expect(to).toHaveValue("");
		expect(snapshot()).toBe(before);
	} finally {
		sql(restore);
	}
});
