import { expect, type Page, test } from "@playwright/test";
import { ADMIN, restAs, signIn, signOut } from "./support";

// evaluation.spec.ts の後に動く(評価期間を切り替えるので最後に置く)。
// 期を上期・下期に分け、上期に目標だけを取り込んで評価せずに締め、下期で上期のチャレンジ目標を引き継ぐ。
const TERM = "E2E期";
const FIRST = `${TERM} 上期`;
const SECOND = `${TERM} 下期`;
/** Excel の「CSV UTF-8」と同じ、BOM 付き UTF-8・CRLF の目標ファイル。社員 4 の目標2件(2件目の一次評価点が 5)。 */
const GOALS_WITH_ERROR = "e2e/fixtures/goals-with-error.csv";
/** 上の誤りを直したもの。社員 6 の行は何も書いていない(取り込まない)。 */
const GOALS = "e2e/fixtures/goals.csv";

async function openFromUserMenu(page: Page, name: string) {
	await page.getByRole("button", { name: "ユーザーメニュー" }).click();
	await page.getByRole("link", { name }).click();
}

async function confirm(page: Page, title: string, label: string) {
	const dialog = page.getByRole("dialog", { name: title });
	await dialog.getByRole("button", { name: label }).click();
	await expect(dialog).toBeHidden();
}

test("a term is divided, its first half closed with goals only, and its challenge goals carried into the second half", async ({
	page,
}) => {
	await test.step("Admin が期を上期・下期に分けて追加する(日付は計算される)", async () => {
		await signIn(page, ADMIN);
		await openFromUserMenu(page, "設定");
		await page.getByLabel("期の名前").fill(TERM);
		await page.getByLabel("開始日").fill("2027-04-01");
		await page.getByLabel("終了日").fill("2028-03-31");
		await page.getByLabel("半期(上期・下期)").check();
		await expect(page.getByRole("list", { name: "追加される評価期間" })).toHaveText(
			`${FIRST}2027-04-01 〜 2027-09-30${SECOND}2027-10-01 〜 2028-03-31`,
		);
		await page.getByLabel("評価が確定していなくても締められる").check();
		await page.getByRole("button", { name: "追加する" }).click();
		await expect(page.getByRole("row", { name: new RegExp(FIRST) })).toContainText(
			"未確定でも締める",
		);
		await expect(page.getByRole("row", { name: new RegExp(SECOND) })).toBeVisible();
	});

	await test.step("上期を開始する(それまでの評価期間はすべて確定済みなので締められる)", async () => {
		await page.getByRole("button", { name: `${FIRST}を開始する` }).click();
		await confirm(
			page,
			`「Release verification」を締めて、「${FIRST}」を開始しますか？`,
			"締めて、次の期間を開始する",
		);
		await expect(page.getByRole("row", { name: new RegExp(FIRST) })).toContainText("実施中");
	});

	await test.step("締めた評価期間は「締め済み」と出て、開始できない(API から直接頼んでも断る)", async () => {
		const closed = page.getByRole("row", { name: /Release verification/ });
		await expect(closed).toContainText("締め済み");
		await expect(page.getByRole("button", { name: "Release verificationを開始する" })).toHaveCount(
			0,
		);
		const admin = await restAs(1);
		const response = await admin("rpc/activate_evaluation_period", { p_period_id: 900001 });
		expect(response.ok).toBe(false);
		expect(await response.text()).toContain("締めた評価期間は、もう一度開始できません。");
		// 断られた後も、評価期間はすべて読めて、状態は変わっていない
		await page.reload();
		await expect(page.getByRole("row", { name: new RegExp(FIRST) })).toContainText("実施中");
		await expect(closed).toContainText("締め済み");
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	await test.step("遡及処理: 締めた評価期間は開き直さず、確定済みのシートを理由つきで直す", async () => {
		await openFromUserMenu(page, "遡及処理");
		await page
			.getByRole("navigation", { name: "締め済みの評価期間" })
			.getByRole("button", { name: "Release verification" })
			.click();
		await page.getByRole("button", { name: "Release test 4さんのシートを直す" }).click();
		const goal = page.getByRole("group", { name: "チャレンジ目標 1" });
		await goal.getByLabel("達成状況 1", { exact: true }).fill("遡及で追記");
		await goal.getByLabel("二次評価").selectOption("4");
		const check = page.getByRole("button", { name: /修正内容を確認/ });
		// 理由が無いうちは確かめられない
		await expect(check).toBeDisabled();
		await page.getByLabel(/修正の理由/).fill("評価会議での訂正");
		await check.click();
		const dialog = page.getByRole("dialog", { name: "締めたシートを修正しますか？" });
		await expect(dialog).toContainText("チャレンジ目標 1・期中目標と達成状況");
		await expect(dialog).toContainText("チャレンジ目標 1・二次評価: 3 → 4");
		await dialog.getByRole("button", { name: "修正を記録する" }).click();
		await expect(page.getByRole("region", { name: "このシートの修正の記録(2件)" })).toContainText(
			"理由: 評価会議での訂正",
		);
		// 評価期間は締めたまま
		await openFromUserMenu(page, "設定");
		await expect(page.getByRole("row", { name: /Release verification/ })).toContainText("締め済み");
	});

	await test.step("遡及処理は Admin だけで、点数は 1〜4 だけ(API から直接頼んでも断る)", async () => {
		const sheets = (await (await (await restAs(4))("evaluation_sheets?select=id")).json()) as {
			id: number;
		}[];
		const sheetId = sheets[0].id;
		const subject = await restAs(4);
		expect(
			(
				await subject("rpc/correct_closed_sheet", {
					p_sheet_id: sheetId,
					p_changes: [{ target: "sheet", field: "first_overall_comment", value: "自分で直す" }],
					p_reason: "改ざん",
				})
			).ok,
		).toBe(false);
		const admin = await restAs(1);
		const tooHigh = await admin("rpc/correct_closed_sheet", {
			p_sheet_id: sheetId,
			p_changes: [{ target: "sheet", field: "status", value: "draft" }],
			p_reason: "状態を戻す",
		});
		expect(tooHigh.ok).toBe(false);
		expect(await tooHigh.text()).toContain("遡及処理で直せない項目です。");
	});

	await test.step("誤りのある CSV は、ファイルと行番号つきで全件弾かれる", async () => {
		await openFromUserMenu(page, "導入処理");
		await page.getByRole("link", { name: /データ取込/ }).click();
		await expect(page.getByText(`実施中の評価期間「${FIRST}」`)).toBeVisible();
		// 目標のファイルを共通評価の欄に選ぶ取り違えは、その旨を伝えて止める
		const common = page.getByLabel("共通評価", { exact: true });
		await common.setInputFiles(GOALS);
		await page.getByRole("button", { name: "内容を確認" }).click();
		await expect(page.getByRole("alert").filter({ hasText: "取り込めません" })).toContainText(
			"目標のファイルが選ばれています。",
		);
		await common.setInputFiles([]);
		await page.getByLabel("目標", { exact: true }).setInputFiles(GOALS_WITH_ERROR);
		await page.getByRole("button", { name: "内容を確認" }).click();
		const errors = page.getByRole("alert").filter({ hasText: "取り込めません" });
		await expect(errors).toContainText("誤りが 1件あります");
		await expect(errors.getByRole("row", { name: /3/ })).toContainText(
			"一次評価点は 1〜4 の数字か空欄にしてください(「5」)。",
		);
		await expect(page.getByRole("button", { name: "取り込む" })).toHaveCount(0);
	});

	await test.step("直した CSV は、確かめてから取り込む(シートは下書きのまま)", async () => {
		await page.getByLabel("目標", { exact: true }).setInputFiles(GOALS);
		await page.getByRole("button", { name: "内容を確認" }).click();
		const summary = page.getByRole("region", { name: "3. 取り込む" });
		await expect(summary).toContainText("対象の社員1人");
		await expect(summary).toContainText("新しく作るシート1枚");
		await expect(summary).toContainText("目標2件");
		await summary.getByRole("button", { name: "取り込む" }).click();
		await confirm(page, `「${FIRST}」の評価シートに取り込みます`, "取り込む");
		await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();
	});

	await test.step("評価が確定していないまま、上期を締めて下期を開始する", async () => {
		await openFromUserMenu(page, "設定");
		await page.getByRole("button", { name: `${SECOND}を開始する` }).click();
		const dialog = page.getByRole("dialog", {
			name: `「${FIRST}」を締めて、「${SECOND}」を開始しますか？`,
		});
		await expect(dialog).toContainText("1 件は、評価が確定していません");
		await confirm(
			page,
			`「${FIRST}」を締めて、「${SECOND}」を開始しますか？`,
			"締めて、次の期間を開始する",
		);
		await expect(page.getByRole("row", { name: new RegExp(SECOND) })).toContainText("実施中");
		await signOut(page);
	});

	await test.step("評価者は、締めた上期の下書きをサーバーから読める", async () => {
		const subject = await restAs(4);
		const sheets = (await (
			await subject("evaluation_sheets?select=id,status,period:evaluation_periods(period_name)")
		).json()) as { id: number; status: string; period: { period_name: string } }[];
		const first = sheets.find((sheet) => sheet.period.period_name === FIRST);
		expect(first?.status).toBe("draft");
		const evaluator = await restAs(2);
		const sheet = (await (await evaluator("rpc/get_sheet", { p_sheet_id: first?.id })).json()) as {
			objectives: { challengeGoal: string }[];
		};
		expect(sheet.objectives.map((goal) => goal.challengeGoal)).toEqual([
			"上期の目標A",
			"上期の目標B",
		]);
	});

	await test.step("本人は、締めた上期の確定していないシートも PDF に出せる", async () => {
		await signIn(page, "RELEASE004");
		await page
			.getByRole("navigation", { name: "評価期間" })
			.getByRole("button", { name: FIRST })
			.click();
		const row = page.getByRole("row", { name: /Release verification|上期/ }).filter({
			hasText: "下書き",
		});
		await expect(row.getByRole("button", { name: "PDF出力" })).toBeVisible();
	});

	await test.step("本人が締めたシートを振り返ると、締め後修正が赤字で示される", async () => {
		await page
			.getByRole("navigation", { name: "評価期間" })
			.getByRole("button", { name: "Release verification" })
			.click();
		await page
			.getByRole("link", { name: /Release verification/ })
			.first()
			.click();
		const notice = page.getByRole("region", { name: "締め後修正があります(2件)" });
		await expect(notice).toContainText("チャレンジ目標 1・期中目標と達成状況");
		await expect(notice).toContainText("チャレンジ目標 1・二次評価3 → 4");
		await expect(notice).toContainText("理由: 評価会議での訂正");
		await page.getByRole("link", { name: "TYPA 評価シート一覧へ" }).click();
	});

	await test.step("下期のシートで、上期のチャレンジ目標を据え置く・見直して更新する(期中目標は引き継がない)", async () => {
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		const previous = page.locator("details", {
			has: page.getByRole("heading", { name: "前期のチャレンジ目標" }),
		});
		// 本人の下書きでは、選べるように開いている
		await expect(previous).toHaveAttribute("open", "");
		await expect(previous).toContainText(`${FIRST}・2件(今期へ引き継ぎ 0件)`);

		await previous
			.getByRole("group", { name: "前期の目標 1 をどうするか" })
			.getByRole("button", { name: "据え置く" })
			.click();
		await expect(page.getByText("前期の目標を、目標 1 に据え置きました")).toBeVisible();
		const panel = page.getByRole("tabpanel");
		// 据え置いた目標は、今期の計画(期中目標)を書くところから始まる。達成状況は写さない
		await expect(panel.getByRole("textbox", { name: /チャレンジ目標/ })).toHaveValue("上期の目標A");
		await expect(panel.getByText("前期から据え置き")).toBeVisible();
		await expect(panel.getByRole("textbox", { name: "達成状況" })).toHaveValue("");
		await panel.getByRole("button", { name: "期中目標を追加" }).click();
		await panel.getByLabel("期中目標 1", { exact: true }).fill("下期の手順を試す");
		await panel.getByRole("button", { name: "目標を保存" }).click();
		await expect(page.getByText("目標 1 を保存しました")).toBeVisible();

		await previous
			.getByRole("group", { name: "前期の目標 2 をどうするか" })
			.getByRole("button", { name: "見直して更新" })
			.click();
		await expect(page.getByRole("tab", { name: /目標 2/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		const challenge = panel.getByRole("textbox", { name: /チャレンジ目標/ });
		await expect(challenge).toBeFocused();
		await challenge.fill("上期の目標Bを、下期は後輩と進める");
		await expect(panel.getByText("前期から更新")).toBeVisible();
		await panel.getByRole("button", { name: "目標を保存" }).click();
		await expect(panel.locator(".continuity-note")).toContainText("上期の目標B");

		await expect(previous).toContainText("目標 1 に据え置き");
		await expect(previous).toContainText("目標 2 で更新");
		await expect(previous.getByRole("button", { name: "据え置く" })).toHaveCount(0);
		// 同じ目標をもう一度引き継ぐことは、API から頼んでも断る
		const subject = await restAs(4);
		const goals = (await (
			await subject("rpc/get_previous_goals", {
				p_sheet_id: Number(page.url().split("/").pop()),
			})
		).json()) as { goals: { id: number; carriedInto: number | null }[] };
		expect(goals.goals.map((goal) => goal.carriedInto)).toEqual([1, 2]);
		const again = await subject("rpc/carry_over_goal", {
			p_sheet_id: Number(page.url().split("/").pop()),
			p_goal_id: goals.goals[0].id,
		});
		expect(again.ok).toBe(false);
	});

	await test.step("Admin でない社員は、導入処理のメニューも、取込の画面も API も使えない", async () => {
		await page.getByRole("button", { name: "ユーザーメニュー" }).click();
		await expect(page.getByRole("link", { name: "導入処理" })).toHaveCount(0);
		await page.goto("/setup/import");
		await expect(page.getByText("Admin のみ操作できます。")).toBeVisible();
		await expect(page.getByRole("button", { name: "内容を確認" })).toHaveCount(0);
		const subject = await restAs(4);
		const response = await subject("rpc/import_sheet_data", {
			p_goals: [],
			p_common: [],
			p_apply: true,
		});
		expect(response.ok).toBe(false);
	});
});
