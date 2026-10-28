import { expect, type Locator, type Page, test } from "@playwright/test";
import { closeSheetWindow, restAs, signIn, signOut } from "./support";

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

async function openOwnSheet(page: Page) {
	await page
		.getByRole("link", { name: /Release verification/ })
		.first()
		.click();
	const goal = page.getByRole("tabpanel");
	await expect(goal.getByText(GOAL)).toBeVisible();
	return goal;
}

/** 本人(社員 4)が、自分のシートの目標の点数をサーバーからどう受け取るか。 */
async function goalScoresSeenBySubject() {
	const rest = await restAs(4);
	// 点数の列はテーブルから直接は読めない
	expect((await rest("milestones?select=first_score")).status).toBe(403);
	const [{ id }] = (await (await rest("evaluation_sheets?select=id")).json()) as { id: number }[];
	const sheet = (await (await rest("rpc/get_sheet", { p_sheet_id: id })).json()) as {
		objectives: { firstScore: number; secondScore: number }[];
	};
	return sheet.objectives[0];
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
	await test.step("本人が目標を書いて送信する", async () => {
		await signIn(page, "RELEASE004");
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		await page.getByRole("button", { name: "目標を編集" }).click();
		await page.getByRole("textbox", { name: "チャレンジ目標" }).fill(GOAL);
		await page.getByRole("button", { name: "期中目標を追加" }).click();
		await page.getByRole("textbox", { name: "期中目標 1", exact: true }).fill("手順を見直す");
		await page.getByRole("button", { name: "期中目標を追加" }).click();
		await page.getByRole("textbox", { name: "期中目標 2", exact: true }).fill("研修を開く");
		// 達成状況は、一次評価者が目標を確定してから書く
		await expect(page.getByRole("textbox", { name: /達成状況/ })).toHaveCount(0);
		await page.screenshot({
			path: test.info().outputPath("period-goals-editor.png"),
			fullPage: true,
		});

		await page.getByRole("button", { name: "目標を保存" }).click();
		// 保存直後に押しても、保存後の読み直しが済むまで送信は待たされる(空欄扱いにならない)
		await page.getByRole("button", { name: "目標を送信する" }).click();
		await confirm(page, "目標を送信しますか？", "目標を送信する");
		await expect(page.getByText(/一次評価者による目標の確認を待っています。/)).toBeVisible();
		await expect(page.getByRole("tabpanel")).toContainText("手順を見直す");
		await expect(page.getByRole("tabpanel")).toContainText("研修を開く");

		// 送信後は目標を書き換えられず、目標が確定するまでは達成状況も書けない
		await expect(page.getByRole("button", { name: "目標を編集" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "達成状況を入力" })).toHaveCount(0);
		await signOut(page);
	});

	await test.step("一次評価者が目標を要修正へ戻し、再送後に確定する", async () => {
		await signIn(page, "RELEASE002");
		let sheet = await openSubordinate(page);
		await expect(sheet.getByRole("button", { name: "評価を入力" })).toHaveCount(0);
		await sheet.getByRole("button", { name: "要修正として下書きに戻す" }).click();
		await page
			.getByRole("dialog", { name: "目標を要修正として戻しますか？" })
			.getByRole("textbox", { name: /差し戻しの理由/ })
			.fill("期中目標の期限を書き添えてください");
		await confirm(page, "目標を要修正として戻しますか？", "理由を添えて戻す");
		await expect(sheet).toBeHidden();
		await signOut(page);
		await signIn(page, "RELEASE004");
		await openOwnSheet(page);
		await expect(page.getByRole("region", { name: /目標の修正を頼まれています/ })).toContainText(
			"期中目標の期限を書き添えてください",
		);
		await expect(page.getByRole("button", { name: "目標を編集" })).toBeVisible();
		await page.getByRole("button", { name: "目標を送信する" }).click();
		await confirm(page, "目標を送信しますか？", "目標を送信する");
		await signOut(page);
		await signIn(page, "RELEASE002");
		sheet = await openSubordinate(page);
		await sheet.getByRole("button", { name: "目標を確定する" }).click();
		await confirm(page, "目標を確定しますか？", "目標を確定する");
		await expect(sheet).toBeHidden();
		await signOut(page);
	});

	await test.step("本人が確定した目標の達成状況だけを記入し、一次評価を依頼する", async () => {
		await signIn(page, "RELEASE004");
		await openOwnSheet(page);
		await expect(page.getByRole("button", { name: "目標を編集" })).toHaveCount(0);
		await page.getByRole("button", { name: "達成状況を入力" }).click();
		await expect(page.getByRole("textbox", { name: "チャレンジ目標" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "期中目標を追加" })).toHaveCount(0);
		await page
			.getByRole("textbox", { name: "達成状況 1", exact: true })
			.fill("手順を試行して改善した");
		await page.getByRole("textbox", { name: "達成状況 2", exact: true }).fill("参加者に案内した");
		await page.getByRole("button", { name: "達成状況を保存" }).click();
		await expect(page.getByRole("tabpanel")).toContainText("参加者に案内した");
		await page.getByRole("button", { name: "一次評価を依頼する" }).click();
		await confirm(page, "一次評価を依頼しますか？", "一次評価を依頼する");
		await expect(page.getByText("一次評価者の評価を待っています。")).toBeVisible();
		await expect(page.getByRole("button", { name: "達成状況を入力" })).toHaveCount(0);
		await signOut(page);
	});

	await test.step("一次評価者のベルに依頼が届き、開くとシートに移って既読になる", async () => {
		await signIn(page, "RELEASE002");
		await page.getByRole("button", { name: "通知（未読 1 件）" }).click();
		const inbox = page.getByRole("region", { name: "通知" });
		await expect(inbox).toBeVisible();
		await page.screenshot({ path: test.info().outputPath("bell-desktop.png") });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({ path: test.info().outputPath("bell-mobile.png") });
		// 狭い画面でも、一覧が画面の外にはみ出さない(CI の幅の広いフォントも字間で再現する)
		for (const spacing of ["", "0.15em"]) {
			expect(
				await page.evaluate((spacing) => {
					document.body.style.letterSpacing = spacing;
					const panel = document.querySelector(".notification-panel") as HTMLElement;
					const box = panel.getBoundingClientRect();
					return (
						document.documentElement.scrollWidth <= window.innerWidth &&
						box.left >= 0 &&
						box.right <= window.innerWidth
					);
				}, spacing),
			).toBe(true);
		}
		await page.evaluate(() => {
			document.body.style.letterSpacing = "";
		});
		await page.setViewportSize({ width: 1280, height: 720 });
		const request = inbox.getByRole("link", {
			name: /Release test 4さんの一次評価の依頼が届きました.*一次評価をお願いします/,
		});
		await request.click();
		await expect(page).toHaveURL(/\/sheet\/\d+$/);
		await expect(page.getByText(GOAL)).toBeVisible();
		await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
		// 読み直しても既読のまま(DB に保存されている)
		await page.reload();
		await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
		await signOut(page);
	});

	await test.step("一次評価者が採点して保存する(まだ確定しない)", async () => {
		await signIn(page, "RELEASE002");
		const sheet = await openSubordinate(page);
		await expect(sheet.getByText(GOAL)).toBeVisible();
		await expect(sheet.locator("img[src=x]")).toHaveCount(0);
		expect(await page.evaluate(() => "__xss" in window)).toBe(false);
		await score(sheet, "一次評価", 4);
		await closeSheetWindow(sheet);
		await signOut(page);
	});

	await test.step("保存されただけの一次評価は、本人には画面でも API でも見えない", async () => {
		expect(await goalScoresSeenBySubject()).toEqual(
			expect.objectContaining({ firstScore: 0, secondScore: 0 }),
		);
		await signIn(page, "RELEASE004");
		const goal = await openOwnSheet(page);
		await expect(goal.getByText("一次評価", { exact: true })).toHaveCount(0);
		await signOut(page);
	});

	await test.step("一次評価者が確定する", async () => {
		await signIn(page, "RELEASE002");
		const sheet = await openSubordinate(page);
		await sheet.getByRole("button", { name: "一次評価を確定する" }).click();
		await confirm(page, "一次評価を確定しますか？", "一次評価を確定する");
		await expect(sheet.getByText("一次評価者の評価を待っています。")).toHaveCount(0);
		await closeSheetWindow(sheet);
		await signOut(page);
	});

	await test.step("一次評価が確定しても、最終確定までは本人に点数を返さない", async () => {
		expect(await goalScoresSeenBySubject()).toEqual(
			expect.objectContaining({ firstScore: 0, secondScore: 0 }),
		);
	});

	await test.step("二次評価者のベルに、二次評価の依頼が届く", async () => {
		await signIn(page, "RELEASE003");
		await page.getByRole("button", { name: "通知（未読 1 件）" }).click();
		await expect(
			page.getByRole("region", { name: "通知" }).getByRole("link", {
				name: /Release test 4さんの一次評価が確定しました.*二次評価をお願いします/,
			}),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await signOut(page);
	});

	await test.step("二次評価者が採点して最終評価を確定する", async () => {
		await signIn(page, "RELEASE003");
		const sheet = await openSubordinate(page);
		await score(sheet, "二次評価", 3);
		await sheet.getByRole("button", { name: "評価を確定する" }).click();
		await confirm(page, "評価を確定しますか？", "評価を確定する");
		await closeSheetWindow(sheet);
		// 最終評価は二次評価の点数で決まる。目標・共通評価ともに 3/4 → 75 点
		await expect(page.getByRole("row", { name: /RELEASE004/ })).toContainText("75");
		await signOut(page);
	});

	await test.step("最終確定後、本人には目標の点数が見え、評価点は見えない", async () => {
		expect(await goalScoresSeenBySubject()).toEqual(
			expect.objectContaining({ firstScore: 4, secondScore: 3 }),
		);
		await signIn(page, "RELEASE004");
		const goal = await openOwnSheet(page);
		await expect(page.getByText("評価が確定しました。内容は変更できません。")).toBeVisible();
		await expect(goal).toContainText(/一次評価\s*4\s*\/\s*4/);
		await expect(page.getByText("75")).toHaveCount(0);
	});
});

test("zero period goals records achievement on the challenge and primary evaluation can finalize it", async ({
	page,
}) => {
	await signIn(page, "RELEASE006");
	await page.getByRole("link", { name: "新規作成" }).click();
	await page.getByRole("button", { name: "評価シートを作成" }).click();
	await page.getByRole("button", { name: "目標を編集" }).click();
	await page.getByRole("textbox", { name: "チャレンジ目標" }).fill("期中目標なしのテーマ");
	await expect(page.getByRole("textbox", { name: "期中目標 1", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "目標を保存" }).click();
	await page.getByRole("button", { name: "目標を送信する" }).click();
	await confirm(page, "目標を送信しますか？", "目標を送信する");
	await signOut(page);
	await signIn(page, "RELEASE002");
	await page
		.getByRole("navigation", { name: "メインナビゲーション" })
		.getByRole("link", { name: "部下の評価" })
		.click();
	await page.getByRole("button", { name: "Release test 6 RELEASE006" }).click();
	let sheet = page.getByRole("dialog", { name: "Release test 6 さんの評価シート" });
	await sheet.getByRole("button", { name: "目標を確定する" }).click();
	await confirm(page, "目標を確定しますか？", "目標を確定する");
	await expect(sheet).toBeHidden();
	await signOut(page);
	await signIn(page, "RELEASE006");
	await page
		.getByRole("link", { name: /Release verification/ })
		.first()
		.click();
	await page.getByRole("button", { name: "達成状況を入力" }).click();
	await page
		.getByRole("textbox", { name: "達成状況", exact: true })
		.fill("テーマに対する実績を記入した");
	await page.getByRole("button", { name: "達成状況を保存" }).click();
	await expect(page.getByRole("tabpanel")).toContainText("テーマに対する実績を記入した");
	await page.getByRole("button", { name: "一次評価を依頼する" }).click();
	await confirm(page, "一次評価を依頼しますか？", "一次評価を依頼する");
	await signOut(page);
	await signIn(page, "RELEASE002");
	await page
		.getByRole("navigation", { name: "メインナビゲーション" })
		.getByRole("link", { name: "部下の評価" })
		.click();
	await page.getByRole("button", { name: "Release test 6 RELEASE006" }).click();
	sheet = page.getByRole("dialog", { name: "Release test 6 さんの評価シート" });
	await score(sheet, "一次評価", 3);
	await sheet.getByRole("button", { name: "評価を確定する" }).click();
	await confirm(page, "評価を確定しますか？", "評価を確定する");
	await expect(sheet.getByText("評価が確定しました。内容は変更できません。")).toBeVisible();
});
