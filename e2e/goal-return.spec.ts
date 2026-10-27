import { expect, type Page, test } from "@playwright/test";
import { isolatedSql } from "../scripts/isolatedApi";
import { restAs, signIn, signOut } from "./support";

// 目標の差し戻しには理由が要り、その理由が本人にだけ、書いたとおりに届くこと。
// 社員 5 を一次 002・二次 003 の部下にして、他のシナリオのシートとは混ぜない。
const sql = (statement: string) => isolatedSql("typa_e2e", statement);
const NAME = "Release test 5";
const DIALOG = "目標を要修正として戻しますか？";
const FIRST_REASON =
	"目標の達成基準を、数値で分かるように書いてください。\n<b>太字</b>にはしないでください";
const SECOND_REASON = "期限も添えてください";

const sheetId = () =>
	Number(sql("select id from public.evaluation_sheets where employee_id=900005"));
const stored = () =>
	sql(
		"select status||'|'||coalesce(goal_return_reason,'(なし)') from public.evaluation_sheets where employee_id=900005",
	);

async function openSubordinate(page: Page) {
	await page
		.getByRole("navigation", { name: "メインナビゲーション" })
		.getByRole("link", { name: "部下の評価" })
		.click();
	await page.getByRole("button", { name: `${NAME} RELEASE005` }).click();
	return page.getByRole("dialog", { name: `${NAME} さんの評価シート` });
}

async function openReturnDialog(page: Page) {
	const sheet = await openSubordinate(page);
	await sheet.getByRole("button", { name: "要修正として下書きに戻す" }).click();
	const dialog = page.getByRole("dialog", { name: DIALOG });
	return {
		sheet,
		dialog,
		reason: dialog.getByRole("textbox", { name: /差し戻しの理由/ }),
		send: dialog.getByRole("button", { name: "理由を添えて戻す" }),
	};
}

async function sendGoals(page: Page) {
	await page.getByRole("button", { name: "目標を送信する" }).click();
	const dialog = page.getByRole("dialog", { name: "目標を送信しますか？" });
	await dialog.getByRole("button", { name: "目標を送信する" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText(/一次評価者による目標の確認を待っています。/)).toBeVisible();
}

async function openOwnSheet(page: Page) {
	await page
		.getByRole("link", { name: /Release verification/ })
		.first()
		.click();
	await expect(page.getByRole("tabpanel")).toBeVisible();
}

const returnNotice = (page: Page) =>
	page.getByRole("region", { name: /一次評価者（Release test 2）から目標の修正を頼まれています/ });

test.beforeAll(() => {
	sql(
		"update public.employees set primary_evaluator_id=900002,secondary_evaluator_id=900003 where id=900005",
	);
});
// 後のシナリオ(term.spec.ts)は、評価期間のシートがすべて確定済みであることを前提に期間を締める。
// 途中で失敗しても、確定していないシートと評価者の設定を残さない
test.afterAll(() => {
	sql(`delete from public.evaluation_sheets where employee_id=900005;
		update public.employees set primary_evaluator_id=null,secondary_evaluator_id=null where id=900005`);
});

test("an evaluator sends goals back with a reason that only the subject reads, as written", async ({
	page,
}) => {
	await test.step("本人が目標を書いて送信する", async () => {
		await signIn(page, "RELEASE005");
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		await page.getByRole("button", { name: "目標を編集" }).click();
		await page
			.getByRole("textbox", { name: "チャレンジ目標" })
			.fill("問い合わせの一次回答を早める");
		await page.getByRole("button", { name: "目標を保存" }).click();
		await sendGoals(page);
		// 差し戻されていないシートには、理由の欄は出ない
		await expect(returnNotice(page)).toHaveCount(0);
		await signOut(page);
	});

	await test.step("API を直接たたいても、理由のない差し戻しや本人による差し戻しはできない", async () => {
		const id = sheetId();
		const primary = await restAs(2);
		for (const p_reason of [undefined, "", " 　\n", "あ".repeat(201)]) {
			const response = await primary("rpc/transition_evaluation_sheet", {
				p_sheet_id: id,
				p_status: "draft",
				...(p_reason === undefined ? {} : { p_reason }),
			});
			expect(response.status, `p_reason=${JSON.stringify(p_reason)}`).toBe(400);
			expect(await response.text()).toContain("差し戻しの理由");
		}
		// 状態だけを書き換える抜け道も、理由の列を直に書くのも断る
		await primary(`evaluation_sheets?id=eq.${id}`, { status: "draft" }, "PATCH");
		const direct = await primary(
			`evaluation_sheets?id=eq.${id}`,
			{ goal_return_reason: "直書き" },
			"PATCH",
		);
		expect(direct.ok).toBe(false);
		// 本人は理由を添えても自分の目標を差し戻せない
		const subject = await restAs(5);
		const own = await subject("rpc/transition_evaluation_sheet", {
			p_sheet_id: id,
			p_status: "draft",
			p_reason: "自分で戻す",
		});
		expect(own.status).toBe(403);
		expect(stored()).toBe("goals_submitted|(なし)");
	});

	await test.step("一次評価者には、書く前に誰が読むかが見え、理由が範囲の外なら戻せない", async () => {
		await signIn(page, "RELEASE002");
		const { sheet, dialog, reason, send } = await openReturnDialog(page);
		// in_app 通知なのでメールの選択肢も、メールに載るという案内も出ない
		await expect(dialog).toContainText(
			`この理由は ${NAME} さんのシートに、書いたとおりに表示されます。`,
		);
		await expect(dialog.getByRole("checkbox")).toHaveCount(0);
		await expect(reason).toBeFocused();
		await expect(send).toBeDisabled();

		await reason.fill(" 　\n ");
		await expect(send).toBeDisabled();
		await reason.fill("あ".repeat(201));
		await expect(dialog.getByText("201 / 200 文字（1 文字多すぎます）")).toBeVisible();
		await expect(reason).toHaveAttribute("aria-invalid", "true");
		await expect(send).toBeDisabled();
		// 絵文字は1文字と数える(DB と同じ)
		await reason.fill("😀".repeat(200));
		await expect(dialog.getByText("200 / 200 文字", { exact: true })).toBeVisible();
		await expect(send).toBeEnabled();

		// 狭い画面でも、欄とボタンが画面の外にはみ出さない
		await page.setViewportSize({ width: 390, height: 844 });
		await reason.fill(FIRST_REASON);
		expect(
			await page.evaluate(() => {
				const box = (
					document.querySelector(".confirm-dialog") as HTMLElement
				).getBoundingClientRect();
				return (
					document.documentElement.scrollWidth <= window.innerWidth &&
					box.right <= window.innerWidth
				);
			}),
		).toBe(true);
		await page.screenshot({ path: test.info().outputPath("return-dialog-mobile.png") });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.screenshot({ path: test.info().outputPath("return-dialog-dark.png") });
		await page.emulateMedia({ colorScheme: "light" });
		await page.screenshot({ path: test.info().outputPath("return-dialog.png") });

		// キャンセル(Esc)しても書いた理由は消えず、戻してもいない
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		expect(stored()).toBe("goals_submitted|(なし)");
		await sheet.getByRole("button", { name: "要修正として下書きに戻す" }).click();
		await expect(reason).toHaveValue(FIRST_REASON);

		await reason.fill(`  ${FIRST_REASON}\n\n`);
		await send.click();
		await expect(dialog).toBeHidden();
		await expect(page.getByText(`${NAME} さんに差し戻しました`)).toBeVisible();
		// 戻した評価者は、下書きになったシートをもう読めない
		await expect(sheet).toBeHidden();
		// 前後の空白を除いて保存する
		expect(stored()).toBe(`draft|${FIRST_REASON}`);
		await signOut(page);
	});

	await test.step("理由は二次評価者には API でも渡らない", async () => {
		const secondary = await restAs(3);
		const response = await secondary("rpc/get_sheet", { p_sheet_id: sheetId() });
		expect(await response.text()).not.toContain("数値で分かるように");
	});

	await test.step("本人のベルに届き、開いたシートに理由が書いたとおりに出る", async () => {
		await signIn(page, "RELEASE005");
		await page.getByRole("button", { name: "通知（未読 1 件）" }).click();
		await page
			.getByRole("region", { name: "通知" })
			.getByRole("link", {
				name: new RegExp(`${NAME}さんの目標が要修正として戻されました.*差し戻しの理由を確認`),
			})
			.click();
		await expect(page).toHaveURL(/\/sheet\/\d+$/);
		const notice = returnNotice(page);
		// 改行を保ち、HTML は文字のまま出す
		await expect(notice.locator("blockquote")).toHaveText(FIRST_REASON);
		await expect(notice.locator("b")).toHaveCount(0);
		await expect(notice).toContainText("もう一度目標を送信してください");
		await page.screenshot({ path: test.info().outputPath("return-notice.png"), fullPage: true });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.screenshot({
			path: test.info().outputPath("return-notice-dark.png"),
			fullPage: true,
		});
		await page.emulateMedia({ colorScheme: "light" });

		const subject = await restAs(5);
		const sheet = (await (await subject("rpc/get_sheet", { p_sheet_id: sheetId() })).json()) as {
			goalReturnReason: string | null;
		};
		expect(sheet.goalReturnReason).toBe(FIRST_REASON);
	});

	await test.step("本人が目標を直して送り直すと、理由の表示は消える", async () => {
		await page.getByRole("button", { name: "目標を編集" }).click();
		await page
			.getByRole("textbox", { name: "チャレンジ目標" })
			.fill("問い合わせの一次回答を、受付から 1 営業日以内にする");
		await page.getByRole("button", { name: "目標を保存" }).click();
		// 保存しただけでは、まだ下書き。理由は残る
		await expect(returnNotice(page)).toBeVisible();
		await sendGoals(page);
		await expect(returnNotice(page)).toHaveCount(0);
		expect(stored()).toBe("goals_submitted|(なし)");
		await page.reload();
		await expect(returnNotice(page)).toHaveCount(0);
		await signOut(page);
	});

	await test.step("二度目の差し戻しでは、前の理由を持ち越さず、新しい理由だけが届く", async () => {
		await signIn(page, "RELEASE002");
		const { dialog, reason, send } = await openReturnDialog(page);
		await expect(reason).toHaveValue("");
		await reason.fill(SECOND_REASON);
		await send.click();
		await expect(dialog).toBeHidden();
		await signOut(page);

		await signIn(page, "RELEASE005");
		// 前の差し戻しの通知は、送り直したときに既読になっている
		await expect(page.getByRole("button", { name: "通知（未読 1 件）" })).toBeVisible();
		await openOwnSheet(page);
		await expect(returnNotice(page).locator("blockquote")).toHaveText(SECOND_REASON);
		await expect(page.getByText("数値で分かるように")).toHaveCount(0);
		await sendGoals(page);
		await signOut(page);
	});

	await test.step("目標の確定には理由の欄が出ず、そのまま確定できる", async () => {
		await signIn(page, "RELEASE002");
		const sheet = await openSubordinate(page);
		await sheet.getByRole("button", { name: "目標を確定する" }).click();
		const dialog = page.getByRole("dialog", { name: "目標を確定しますか？" });
		await expect(dialog.getByRole("textbox")).toHaveCount(0);
		await dialog.getByRole("button", { name: "目標を確定する" }).click();
		await expect(dialog).toBeHidden();
		expect(stored()).toBe("goals_confirmed|(なし)");
		await signOut(page);
	});
});
