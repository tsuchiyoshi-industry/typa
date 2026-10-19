import { expect, type Locator, type Page, test } from "@playwright/test";
import { signIn, signOut } from "./support";

// 内部の人が入力欄に仕込んだ HTML は、評価者の画面で文字として出るだけで実行されない
const GOAL = '受注処理の手戻りを半減する<img src=x onerror="window.__xss=1">';

// E2E では通知用の Edge Function を立てないので、選べる通知は送らない設定で確定する。
// 最終確定には選択肢がなく、通知の失敗はトーストで知らされるだけで確定は済む。
async function confirm(page: Page, title: string, label: string) {
	const dialog = page.getByRole("dialog", { name: title });
	const notice = dialog.getByRole("checkbox");
	if (await notice.count()) {
		await notice.uncheck();
	}
	await dialog.getByRole("button", { name: label }).click();
	await expect(dialog).toBeHidden();
}

async function score(sheet: Locator, stage: "一次評価" | "二次評価", value: number) {
	await sheet.getByRole("tabpanel").getByRole("button", { name: "評価を入力" }).click();
	await sheet.getByRole("button", { name: `${stage} ${value}`, exact: true }).click();
	await sheet.getByRole("tabpanel").getByRole("button", { name: "評価を保存" }).click();
	await expect(
		sheet.getByRole("tabpanel").getByRole("button", { name: "評価を入力" }),
	).toBeVisible();

	const common = sheet.getByRole("article").filter({ hasText: "共通評価" });
	await common.getByRole("button", { name: "評価を入力" }).click();
	for (const item of ["Release item A", "Release item B"]) {
		await common.getByRole("button", { name: `${item} ${stage} ${value}`, exact: true }).click();
	}
	await common.getByRole("button", { name: "評価を保存" }).first().click();
	await expect(common.getByRole("button", { name: "評価を入力" })).toBeVisible();
}

async function openSubordinate(page: Page) {
	await page
		.getByRole("navigation", { name: "メインナビゲーション" })
		.getByRole("link", { name: "部下の評価" })
		.click();
	await page.getByRole("button", { name: "Release test 4 RELEASE004" }).click();
	return page.getByRole("dialog", { name: "Release test 4 さんの評価シート" });
}

test("a sheet goes from the employee through both evaluators to a final rank", async ({ page }) => {
	await test.step("本人が目標を書いて提出する", async () => {
		await signIn(page, "RELEASE004");
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		await page.getByRole("button", { name: "目標を編集" }).click();
		await page.getByRole("textbox", { name: "チャレンジ目標" }).fill(GOAL);
		await page.getByRole("button", { name: "目標を保存" }).click();
		// 保存直後に押しても、保存後の読み直しが済むまで提出は待たされる(空欄扱いにならない)
		await page.getByRole("button", { name: "提出する" }).click();
		await confirm(page, "評価シートを提出しますか？", "提出する");
		await expect(page.getByText("一次評価者の評価を待っています。")).toBeVisible();
		// 提出後は目標を書き換えられない
		await expect(page.getByRole("button", { name: "目標を編集" })).toHaveCount(0);
		await signOut(page);
	});

	await test.step("一次評価者が採点して確定する", async () => {
		await signIn(page, "RELEASE002");
		const sheet = await openSubordinate(page);
		await expect(sheet.getByText(GOAL)).toBeVisible();
		await expect(sheet.locator("img[src=x]")).toHaveCount(0);
		expect(await page.evaluate(() => "__xss" in window)).toBe(false);
		await score(sheet, "一次評価", 4);
		await sheet.getByRole("button", { name: "一次評価を確定する" }).click();
		await confirm(page, "一次評価を確定しますか？", "一次評価を確定する");
		await expect(sheet.getByText("一次評価者の評価を待っています。")).toHaveCount(0);
		await sheet.getByRole("button", { name: "閉じる" }).click();
		await signOut(page);
	});

	await test.step("二次評価者が採点して最終評価を確定する", async () => {
		await signIn(page, "RELEASE003");
		const sheet = await openSubordinate(page);
		await score(sheet, "二次評価", 3);
		await sheet.getByRole("button", { name: "評価を確定する" }).click();
		await confirm(page, "評価を確定しますか？", "評価を確定する");
		await sheet.getByRole("button", { name: "閉じる" }).click();
		// 最終評価は二次評価の点数で決まる。目標・共通評価ともに 3/4 → 75 点
		await expect(page.getByRole("row", { name: /RELEASE004/ })).toContainText("75");
		await signOut(page);
	});

	await test.step("本人には確定したことだけが見え、点数は見えない", async () => {
		await signIn(page, "RELEASE004");
		await page
			.getByRole("link", { name: /Release verification/ })
			.first()
			.click();
		await expect(page.getByText("最終評価済みです。内容は変更できません。")).toBeVisible();
		await expect(page.getByText("75")).toHaveCount(0);
	});
});
