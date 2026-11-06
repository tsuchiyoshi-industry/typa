import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "./support";

// 等級と共通目標のマスタ。この spec で足した等級と共通目標は最後に消すので、ほかの spec の DB は変わらない。
const SET = "E2E 共通目標";
const GRADE = "E2E 等級";

async function openFromMenu(page: Page, name: "等級" | "共通目標") {
	await page.getByRole("button", { name: "ユーザーメニュー" }).click();
	await page.locator("#user-menu").getByRole("link", { name, exact: true }).click();
	await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
}

async function confirm(page: Page, label: string) {
	await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}

test("an Admin adds common goals and a grade that uses them, then removes both", async ({
	page,
}) => {
	await signIn(page, ADMIN);

	await test.step("共通目標を追加する", async () => {
		await openFromMenu(page, "共通目標");
		await page.getByRole("button", { name: "共通目標を追加", exact: true }).click();
		await page.getByRole("textbox", { name: "名前", exact: true }).fill(SET);
		await page.getByRole("textbox", { name: "1 行目の項目名", exact: true }).fill("報告");
		await page.getByRole("spinbutton", { name: "1 行目の重み", exact: true }).fill("2");
		await page.getByRole("button", { name: "項目を追加", exact: true }).click();
		await page.getByRole("textbox", { name: "2 行目の項目名", exact: true }).fill("改善");
		await page.getByRole("button", { name: "保存する", exact: true }).click();
		await expect(
			page.getByRole("status").filter({ hasText: `共通目標「${SET}」を追加しました` }),
		).toBeVisible();
		await expect(page.getByRole("combobox", { name: "編集する共通目標", exact: true })).toHaveValue(
			/\d+/,
		);
		await expect(page.getByText("2 項目・重みの合計 3")).toBeVisible();
	});

	await test.step("その共通目標を使う等級を追加する", async () => {
		await openFromMenu(page, "等級");
		await page.getByRole("textbox", { name: "等級名", exact: true }).fill(GRADE);
		await page
			.getByRole("combobox", { name: "共通目標", exact: true })
			.selectOption({ label: SET });
		await page.getByRole("button", { name: "追加する", exact: true }).click();
		await expect(
			page.getByRole("status").filter({ hasText: `等級「${GRADE}」を追加しました` }),
		).toBeVisible();
		await expect(
			page.getByRole("row", { name: new RegExp(`${GRADE}\\s*${SET}\\s*0 人\\s*0 枚`) }),
		).toBeVisible();
	});

	await test.step("等級が使っている共通目標は消せない", async () => {
		await openFromMenu(page, "共通目標");
		await page
			.getByRole("combobox", { name: "編集する共通目標", exact: true })
			.selectOption({ label: SET });
		await expect(page.getByText(GRADE, { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "この共通目標を削除", exact: true }).click();
		await confirm(page, "削除する");
		await expect(
			page.getByRole("alert").filter({ hasText: `等級(${GRADE})が使っています` }),
		).toBeVisible();
	});

	await test.step("等級、共通目標の順に消す", async () => {
		await openFromMenu(page, "等級");
		await page.getByRole("button", { name: `${GRADE}を削除`, exact: true }).click();
		await confirm(page, "削除する");
		await expect(page.getByRole("row", { name: new RegExp(GRADE) })).toHaveCount(0);
		await openFromMenu(page, "共通目標");
		await page
			.getByRole("combobox", { name: "編集する共通目標", exact: true })
			.selectOption({ label: SET });
		await page.getByRole("button", { name: "この共通目標を削除", exact: true }).click();
		await confirm(page, "削除する");
		await expect(
			page.getByRole("status").filter({ hasText: `共通目標「${SET}」を削除しました` }),
		).toBeVisible();
		await expect(
			page
				.getByRole("combobox", { name: "編集する共通目標", exact: true })
				.getByRole("option", { name: SET }),
		).toHaveCount(0);
	});
});

test("someone who is not an Admin cannot open the master by URL", async ({ page }) => {
	await signIn(page, "RELEASE002");
	await page.getByRole("button", { name: "ユーザーメニュー" }).click();
	await expect(
		page.locator("#user-menu").getByRole("link", { name: "等級", exact: true }),
	).toHaveCount(0);
	for (const path of ["/grades", "/common-goals"]) {
		await page.goto(path);
		await expect(page.getByRole("alert")).toContainText("Admin のみ利用できます");
		await expect(page.getByRole("table")).toHaveCount(0);
	}
});
