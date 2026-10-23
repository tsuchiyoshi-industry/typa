import { expect, test } from "@playwright/test";
import { isolatedSql } from "../scripts/isolatedApi";
import { ADMIN, signIn } from "./support";

// 認証・設定の読み書きは隔離した実 API を使う。Edge Function だけ差し替え、外部へメールを送らない。
// 差し替えた関数は、送信テストに成功したときに本物と同じ列を保存する。
// Edge Function の権限と DB 非更新は verifyReleaseApi、SMTP の実通信は smtp.test.ts で確認する。
test("Admin saves mail settings only after a test mail, then may choose mail over in-app notices", async ({
	page,
}) => {
	const sql = (statement: string) => isolatedSql("typa_e2e", statement);
	const restore = sql(`select format(
		'update public.workspace_settings set smtp_host=%L,smtp_port=%L,smtp_user=%L,smtp_password=%L,smtp_verified_at=null,notification_channel=''in_app'';',
		smtp_host,smtp_port,smtp_user,smtp_password) from public.workspace_settings`);
	const snapshot = () =>
		sql(`select json_build_object(
			'settings', (select row_to_json(s) from public.workspace_settings s),
			'deliveries', (select count(*) from public.sheet_notification_deliveries))`);
	try {
		// 送信テストの仕組みより前に保存された、確かめていない設定
		sql(`update public.workspace_settings set smtp_host='smtp.example.jp',smtp_port=465,
			smtp_user='sender@example.jp',smtp_password='synthetic-test-password',
			smtp_verified_at=null,notification_channel='in_app'`);
		const before = snapshot();
		const requests: { smtp?: { host: string; port: number; user: string } }[] = [];
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
			const body = route.request().postDataJSON();
			requests.push(body);
			if (!failNext && body.smtp) {
				sql(`update public.workspace_settings set smtp_host='${body.smtp.host}',
					smtp_port=${Number(body.smtp.port)},smtp_user='${body.smtp.user}',smtp_verified_at=now()`);
			}
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
		const settings = page.getByRole("region", { name: "通知", exact: true });
		const inApp = settings.getByRole("radio", { name: /アプリ内通知/ });
		const mail = settings.getByRole("radio", { name: /メール/ });
		const to = settings.getByLabel("宛先メールアドレス", { exact: true });
		const pattern = settings.getByRole("combobox", { name: "通知パターン" });
		const save = settings.getByRole("button", { name: "テストメールを送って保存する" });

		// 既定はアプリ内通知。確かめていない設定ではメールを選べない
		await expect(inApp).toBeChecked();
		await expect(mail).toBeDisabled();

		// 宛先がなければ送らない
		await save.click();
		await expect(to).toBeFocused();
		await to.fill("not-an-address");
		await save.click();
		await expect(to).toBeFocused();
		expect(requests).toHaveLength(0);

		// 失敗したら何も保存せず、SMTP の応答を見せ、入力を残す
		await to.fill("test-recipient@example.jp");
		await pattern.selectOption({ label: "一次評価確定通知（二次評価の依頼）" });
		failNext = true;
		await save.click();
		await expect(
			page.getByRole("alert").filter({ hasText: "詳細: EAUTH: Invalid login: 535" }),
		).toBeVisible();
		await expect(save).toBeEnabled();
		await expect(to).toHaveValue("test-recipient@example.jp");
		await expect(mail).toBeDisabled();
		expect(snapshot()).toBe(before);

		// 届いたら保存され、メールを選べるようになる。パスワードは空欄なら登録済みのもの
		await save.click();
		await expect(
			page.getByRole("status").filter({ hasText: "通知メールの設定を保存しました" }),
		).toBeVisible();
		expect(requests.at(-1)).toEqual({
			mode: "save",
			to: "test-recipient@example.jp",
			templateId: "first_evaluated",
			smtp: { host: "smtp.example.jp", port: 465, user: "sender@example.jp", password: "" },
		});
		await expect(mail).toBeEnabled();
		await expect(settings.getByText(/送信テスト済み/)).toBeVisible();

		// 方法は選んだらすぐ保存する
		await mail.check();
		await expect(page.getByRole("status").filter({ hasText: "メールで知らせます" })).toBeVisible();
		await expect
			.poll(() => sql("select notification_channel from public.workspace_settings"))
			.toBe("email");
		await inApp.check();
		await expect
			.poll(() => sql("select notification_channel from public.workspace_settings"))
			.toBe("in_app");

		await settings.scrollIntoViewIfNeeded();
		await page.screenshot({ path: test.info().outputPath("smtp-desktop.png"), fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await settings.scrollIntoViewIfNeeded();
		await expect(save).toBeVisible();
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
	} finally {
		sql(restore);
	}
});
