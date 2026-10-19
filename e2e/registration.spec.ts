import { expect, type Page, test } from "@playwright/test";
import { ADMIN, issueOtp, PASSWORD, signIn, signOut } from "./support";

const NEWCOMER = "RELEASE007";
const SHARED_MAILBOX = "shared-pc@release.example";

async function openEmployeeMaster(page: Page) {
	await page
		.getByRole("navigation", { name: "メインナビゲーション" })
		.getByRole("link", { name: "社員マスタ" })
		.click();
	await expect(page.getByRole("heading", { name: "社員一覧" })).toBeVisible();
}

test("an invited employee registers with a shared mailbox and can be suspended", async ({
	page,
}) => {
	let invitation = "";
	await test.step("Admin が未登録者の招待コードを一括発行する", async () => {
		await signIn(page, ADMIN);
		await openEmployeeMaster(page);
		await page.getByRole("button", { name: "招待コードを一括発行" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "まとめて発行" }).click();
		const issued = await page.getByRole("textbox", { name: "招待コードの一覧" }).inputValue();
		const row = issued.split("\n").find((line) => line.startsWith(`${NEWCOMER}\t`));
		invitation = row?.split("\t")[2] ?? "";
		expect(invitation).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

		// 期限内のコードは配り済みとみなし、もう一度押しても出し直さない
		await page.getByRole("button", { name: "閉じる", exact: true }).click();
		await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
		await page.getByRole("button", { name: "招待コードを一括発行" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "まとめて発行" }).click();
		await expect(page.getByText("発行する相手はいません")).toBeVisible();
		await signOut(page);
	});

	await test.step("本人が共有PCのメールで認証して登録する", async () => {
		await page.getByRole("button", { name: "新規登録" }).click();
		await page.getByLabel("メールアドレス").fill(SHARED_MAILBOX);
		await page.getByRole("button", { name: "認証コードを受け取る" }).click();
		// 送信が済むと入力欄が出る。先に発行すると、送信中の処理とアカウント作成がぶつかる
		await expect(page.getByLabel("認証コード")).toBeVisible();
		await page.getByLabel("認証コード").fill(await issueOtp(SHARED_MAILBOX));
		await page.getByLabel("社員番号").fill(NEWCOMER);
		await page.getByLabel("招待コード").fill(invitation.toLowerCase());
		await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
		await page.getByLabel("パスワード（確認）").fill(PASSWORD);
		await page.getByRole("button", { name: "登録する" }).click();

		const done = page.getByRole("dialog", { name: `あなたの社員番号は「${NEWCOMER}」です` });
		await done.getByRole("button", { name: "覚えました" }).click();
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await signOut(page);
	});

	await test.step("社員番号とパスワードでログインできる", async () => {
		await signIn(page, NEWCOMER);
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await signOut(page);
	});

	await test.step("Admin が利用停止すると、ログインが断られる", async () => {
		await signIn(page, ADMIN);
		await openEmployeeMaster(page);
		await page.getByRole("button", { name: "Release unregisteredさんの利用を停止する" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "利用を停止" }).click();
		await expect(
			page.getByRole("button", { name: "Release unregisteredさんの利用を再開する" }),
		).toBeVisible();
		await signOut(page);

		await signIn(page, NEWCOMER);
		await expect(page.getByRole("alert")).toContainText("利用が停止されています");
	});
});
