import { expect, test } from "@playwright/test";
import { ADMIN, signIn, signOut } from "./support";

test("wrong password is refused and the right one opens the sheet list", async ({ page }) => {
	await signIn(page, ADMIN, "Wrong0password");
	await expect(page.getByRole("alert")).toContainText("社員番号またはパスワードが正しくありません");

	await signIn(page, ADMIN);
	await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
	await signOut(page);
});
