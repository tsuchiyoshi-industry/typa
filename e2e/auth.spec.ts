import { expect, test } from "@playwright/test";
import { ADMIN, signIn, signOut } from "./support";

test("wrong password is refused and the right one opens the sheet list", async ({ page }) => {
	await signIn(page, ADMIN, "Wrong0password");
	await expect(page.getByRole("alert")).toContainText("社員番号またはパスワードが正しくありません");

	await signIn(page, ADMIN);
	await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();

	// ログインしたまま起動し直しても、読み込み画面は初期セットアップの一度だけ
	await page.addInitScript(() => {
		let shown = 0;
		new MutationObserver((records) => {
			for (const record of records) {
				// 待ちの画面は、まとめて差し込まれる要素の内側に入っていることもある
				for (const node of record.addedNodes) {
					if (node instanceof HTMLElement) {
						shown +=
							Number(node.matches(".loading-container")) +
							node.querySelectorAll(".loading-container").length;
					}
				}
			}
		}).observe(document, { childList: true, subtree: true });
		Object.assign(window, { loadingShown: () => shown });
	});
	await page.reload();
	await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
	expect(
		await page.evaluate(() => (window as unknown as { loadingShown: () => number }).loadingShown()),
	).toBe(1);
	await signOut(page);
});
