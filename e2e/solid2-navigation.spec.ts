import { expect, test } from "@playwright/test";
import { captureBrowserArtifact } from "@solidjs/diagnostics/playwright";
import { ADMIN, signIn } from "./support";

test("master navigation releases the previous page's reactive graph", async ({
	page,
}, testInfo) => {
	test.slow();
	await signIn(page, ADMIN);
	await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
	const { artifact } = await captureBrowserArtifact(
		page,
		async () => {
			for (let visit = 0; visit < 5; visit++) {
				for (const name of ["共通目標", "等級"] as const) {
					await page.getByRole("button", { name: "ユーザーメニュー" }).click();
					await page.locator("#user-menu").getByRole("link", { name, exact: true }).click();
					await expect(page.getByRole("heading", { name, level: 1, exact: true })).toBeVisible();
					await expect(
						page.getByRole("textbox", { name: name === "等級" ? "等級名" : "名前", exact: true }),
					).toBeVisible();
				}
			}
		},
		{ scenario: "master-navigation" },
	);
	await testInfo.attach("reactive-navigation", {
		body: JSON.stringify(artifact),
		contentType: "application/json",
	});
	expect(artifact.diagnostics.filter((event) => event.code === "GRAPH_GROWTH")).toEqual([]);
	expect(artifact.diagnostics.filter((event) => event.severity === "error")).toEqual([]);
});
