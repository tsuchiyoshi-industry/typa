import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { isolatedSql } from "../scripts/isolatedApi";
import { ADMIN, closeSheetWindow, signIn, signOut } from "./support";

// 利用者・評価者・管理者のマニュアル(docs/manual/*.md)の画面写真を撮り、PDF にする。
// 写真はどれも、そのマニュアルを読む権限の人がログインした画面。合否より、資料がそろうことが目的。
const MANUALS = [
	["user", "TYPA 利用者マニュアル"],
	["evaluator", "TYPA 評価者マニュアル"],
	["admin", "TYPA 管理者マニュアル"],
] as const;
type Manual = (typeof MANUALS)[number][0];

// 保存のたびに出るトーストは説明の邪魔なので写さない。縦に長い部分を撮るとき、
// 上部に固定したバーが途中に写り込まないよう、撮る間だけ固定を外す
const HIDE = ".toast-stack{display:none}.dashboard-topbar{position:static!important}";
const shot = (target: Page | Locator, manual: Manual, name: string) =>
	target.screenshot({
		path: `docs/manual/${manual}/${name}.png`,
		style: HIDE,
		animations: "disabled",
	});

// 合成データの英字名を、マニュアルで読みやすい名前に置き換える
test.beforeAll(() => {
	isolatedSql(
		"typa_e2e",
		`update public.employees e set name = v.name from (values
      (900001,'総務 花子'),(900002,'佐藤 一郎'),(900003,'鈴木 次郎'),(900004,'佐藤 三郎'),
      (900005,'高橋 健'),(900006,'伊藤 さくら'),(900007,'渡辺 翔'),(900009,'山本 大輔')
    ) v(id,name) where e.id = v.id;
    update public.common_evaluation_items set
      title = case id when 900001 then '報告・連絡・相談' else '業務改善' end,
      description = case id when 900001 then '必要な情報を、必要な相手に、遅れず伝えている' else '担当業務のやり方を見直し、手間やミスを減らしている' end
      where id in (900001,900002);
    update public.common_evaluation_item_sets set name = '一般職' where id = 9001;
    update public.employee_grades set grade_name = '一般職' where id = 9001;
    update public.evaluation_periods set period_name = '2026年度 下期' where id = 900001;`,
	);
});

async function confirm(page: Page, title: string, label: string) {
	const dialog = page.getByRole("dialog", { name: title });
	const notice = dialog.getByRole("checkbox");
	if (await notice.count()) {
		await notice.uncheck();
	}
	await dialog.getByRole("button", { name: label }).click();
	await expect(dialog).toBeHidden();
}

const nav = (page: Page, name: string) =>
	page
		.getByRole("navigation", { name: "メインナビゲーション" })
		.getByRole("link", { name })
		.click();

async function menu(page: Page, name: string) {
	await page.getByRole("button", { name: "ユーザーメニュー" }).click();
	await page.getByRole("link", { name }).click();
}

/** 本人がシートを作り、目標を書いて提出する。 */
async function writeSheet(
	page: Page,
	goal: { challenge: string; midterm: string; achievement: string },
	beforeSave?: () => Promise<unknown>,
) {
	await page.getByRole("button", { name: "目標を編集" }).click();
	await page.getByRole("textbox", { name: "チャレンジ目標" }).fill(goal.challenge);
	await page.getByRole("textbox", { name: "中間目標" }).fill(goal.midterm);
	await page.getByRole("textbox", { name: "達成状況" }).fill(goal.achievement);
	await beforeSave?.();
	await page.getByRole("button", { name: "目標を保存" }).click();
	await expect(page.getByRole("button", { name: "目標を編集" })).toBeVisible();
}

async function scoreGoal(sheet: Locator, stage: "一次評価" | "二次評価", value: number) {
	await sheet.getByRole("tabpanel").getByRole("button", { name: "評価を入力" }).click();
	await sheet.getByRole("button", { name: `${stage} ${value}`, exact: true }).click();
}

async function saveGoalScore(sheet: Locator) {
	await sheet.getByRole("tabpanel").getByRole("button", { name: "評価を保存" }).click();
	await expect(
		sheet.getByRole("tabpanel").getByRole("button", { name: "評価を入力" }),
	).toBeVisible();
}

const commonCard = (sheet: Locator) => sheet.getByRole("article").filter({ hasText: "共通評価" });

async function scoreCommon(
	sheet: Locator,
	stage: "一次評価" | "二次評価",
	values: [number, number],
	comments?: [string, string],
) {
	const common = commonCard(sheet);
	await common.getByRole("button", { name: "評価を入力" }).click();
	for (const [index, item] of ["報告・連絡・相談", "業務改善"].entries()) {
		await common
			.getByRole("button", { name: `${item} ${stage} ${values[index]}`, exact: true })
			.click();
		if (comments) {
			await common
				.getByRole("textbox", { name: `${item} 一次評価者コメント` })
				.fill(comments[index]);
		}
	}
}

async function saveCommon(sheet: Locator) {
	const common = commonCard(sheet);
	await common.getByRole("button", { name: "評価を保存" }).first().click();
	await expect(common.getByRole("button", { name: "評価を入力" })).toBeVisible();
}

async function overall(sheet: Locator, label: string, text: string) {
	await sheet.getByRole("textbox", { name: label }).fill(text);
	await sheet.getByRole("button", { name: "総評を保存" }).click();
	await expect(sheet.getByText("保存済み")).toBeVisible();
}

async function openReview(page: Page, name: string, employeeNo: string) {
	await page.getByRole("button", { name: `${name} ${employeeNo}` }).click();
	return page.getByRole("dialog", { name: `${name} さんの評価シート` });
}

test("manual screenshots", async ({ page }) => {
	test.setTimeout(240_000);
	await test.step("利用者: ログインと新規登録", async () => {
		await page.goto("/login");
		await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
		await shot(page, "user", "01-login");
		await page.getByRole("button", { name: "新規登録" }).click();
		await page.getByLabel("メールアドレス").fill("watanabe@release.example");
		await shot(page, "user", "02-register-email");
		await page.getByRole("button", { name: "認証コードを受け取る" }).click();
		await expect(page.getByLabel("認証コード")).toBeVisible();
		await shot(page, "user", "03-register-code");
	});

	await test.step("利用者(二次評価者なし): 作成・提出", async () => {
		await signIn(page, "RELEASE006");
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		await writeSheet(page, {
			challenge: "問い合わせ対応の手順書を作り、平均対応時間を15分から10分にする",
			midterm: "12月末までによくある問い合わせを整理し、手順書の案を作る",
			achievement: "手順書を作成してチームに共有した。平均対応時間は11分になった",
		});
		await page.getByRole("button", { name: "提出する" }).click();
		await confirm(page, "評価シートを提出しますか？", "提出する");
		await signOut(page);
	});

	await test.step("利用者: 作成・記入・提出", async () => {
		await signIn(page, "RELEASE004");
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await expect(page.getByText("自分の評価シートはまだありません")).toBeVisible();
		await shot(page, "user", "04-sheet-list-empty");
		await page.getByRole("link", { name: "新規作成" }).click();
		await expect(page.getByRole("button", { name: "評価シートを作成" })).toBeVisible();
		await shot(page, "user", "05-new-sheet");
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		await expect(page.getByRole("button", { name: "目標を編集" })).toBeVisible();
		await shot(page, "user", "06-sheet");
		await writeSheet(
			page,
			{
				challenge: "受注処理の手戻りを、半年で月20件から10件に減らす",
				midterm: "12月末までに手戻りの原因を分類し、上位3つの対策を決める",
				achievement: "入力チェック表を作って運用した。3月の手戻りは月9件になった",
			},
			() => shot(page.locator(".challenge-card"), "user", "07-goal"),
		);
		await page.getByRole("button", { name: "提出する" }).click();
		await expect(page.getByRole("dialog", { name: "評価シートを提出しますか？" })).toBeVisible();
		await shot(page, "user", "08-submit");
		await confirm(page, "評価シートを提出しますか？", "提出する");
		await expect(page.getByText("一次評価者の評価を待っています。")).toBeVisible();
		await shot(page, "user", "09-submitted");
		await signOut(page);
	});

	await test.step("一次評価者", async () => {
		await signIn(page, "RELEASE002");
		await nav(page, "部下の評価");
		await expect(page.getByRole("button", { name: "佐藤 三郎 RELEASE004" })).toBeVisible();
		await shot(page, "evaluator", "01-workspace");

		const sheet = await openReview(page, "佐藤 三郎", "RELEASE004");
		await expect(sheet.getByText("受注処理の手戻り").first()).toBeVisible();
		await shot(page, "evaluator", "02-sheet");
		await scoreGoal(sheet, "一次評価", 4);
		await shot(page, "evaluator", "03-goal-score");
		await saveGoalScore(sheet);
		await scoreCommon(
			sheet,
			"一次評価",
			[4, 3],
			["遅れが出そうなときに、早めに相談してくれた", "入力チェック表で、チームの手戻りも減った"],
		);
		await commonCard(sheet).scrollIntoViewIfNeeded();
		await shot(page, "evaluator", "04-common-score");
		await saveCommon(sheet);
		await overall(
			sheet,
			"一次評価者の総評",
			"原因の分類から対策まで自分で進め、目標を達成した。次は他部署との手順統一に挑戦してほしい。",
		);
		await sheet.getByRole("button", { name: "一次評価を確定する" }).scrollIntoViewIfNeeded();
		await shot(page, "evaluator", "05-overall");
		await sheet.getByRole("button", { name: "一次評価を確定する" }).click();
		await expect(page.getByRole("dialog", { name: "一次評価を確定しますか？" })).toBeVisible();
		await shot(page, "evaluator", "06-confirm-first");
		await confirm(page, "一次評価を確定しますか？", "一次評価を確定する");

		// 確定すると、次の自分の番(二次評価者なしの伊藤さん)へ進む
		const next = page.getByRole("dialog", { name: "伊藤 さくら さんの評価シート" });
		await expect(next.getByText("問い合わせ対応の手順書").first()).toBeVisible();
		await scoreGoal(next, "一次評価", 3);
		await saveGoalScore(next);
		await scoreCommon(next, "一次評価", [3, 3]);
		await saveCommon(next);
		await overall(next, "一次評価者の総評", "手順書は好評。対応時間はあと一歩だった。");
		await next.getByRole("button", { name: "評価を確定する" }).click();
		await expect(page.getByRole("dialog", { name: "評価を確定しますか？" })).toBeVisible();
		await shot(page, "evaluator", "07-confirm-no-secondary");
		await confirm(page, "評価を確定しますか？", "評価を確定する");
		await closeSheetWindow(page.getByRole("dialog", { name: /さんの評価シート/ }));
		await signOut(page);
	});

	await test.step("二次評価者", async () => {
		await signIn(page, "RELEASE003");
		await nav(page, "部下の評価");
		await expect(page.getByRole("button", { name: "佐藤 三郎 RELEASE004" })).toBeVisible();
		await shot(page, "evaluator", "08-workspace-second");
		const sheet = await openReview(page, "佐藤 三郎", "RELEASE004");
		await scoreGoal(sheet, "二次評価", 3);
		await saveGoalScore(sheet);
		await scoreCommon(sheet, "二次評価", [3, 3]);
		await commonCard(sheet).scrollIntoViewIfNeeded();
		await shot(page, "evaluator", "09-second-score");
		await saveCommon(sheet);
		await overall(
			sheet,
			"二次評価者の総評",
			"成果は十分。周囲への展開まで含めて B+ 相当と判断した。",
		);
		await sheet.getByRole("button", { name: "二次評価を確定する" }).click();
		await expect(page.getByRole("dialog", { name: "評価を確定しますか？" })).toBeVisible();
		await shot(page, "evaluator", "10-finalize");
		await confirm(page, "評価を確定しますか？", "評価を確定する");
		await closeSheetWindow(page.getByRole("dialog", { name: /さんの評価シート/ }));
		await expect(page.getByRole("row", { name: /RELEASE004/ })).toContainText("最終評価済み");
		await shot(page, "evaluator", "11-final");
		await signOut(page);
	});

	await test.step("一次評価者: 比較・一覧・社員マスタ", async () => {
		await signIn(page, "RELEASE002");
		await expect(page.getByRole("heading", { name: "部下の評価シート" })).toBeVisible();
		await shot(page, "evaluator", "12-sheet-list");
		await nav(page, "部下の評価");
		await page.getByRole("checkbox", { name: "佐藤 三郎を比較に選択" }).check();
		await page.getByRole("checkbox", { name: "伊藤 さくらを比較に選択" }).check();
		await page.getByRole("button", { name: /選択して比較/ }).click();
		await expect(page.getByRole("dialog", { name: "選択した対象者の比較" })).toBeVisible();
		await shot(page, "evaluator", "13-compare");
		await closeSheetWindow(page.getByRole("dialog", { name: "選択した対象者の比較" }));
		await nav(page, "社員マスタ");
		await expect(page.getByRole("heading", { name: "社員一覧" })).toBeVisible();
		await shot(page, "evaluator", "14-master");
		await signOut(page);
	});

	await test.step("利用者: 結果・メニュー・ヘルプ", async () => {
		await signIn(page, "RELEASE004");
		await expect(page.getByRole("button", { name: "PDF出力" })).toBeVisible();
		await shot(page, "user", "10-sheet-list-final");
		await page.getByRole("link", { name: /一般職/ }).click();
		await expect(page.getByText("最終評価済みです。内容は変更できません。")).toBeVisible();
		await shot(page, "user", "11-result");
		await page.getByRole("button", { name: "ユーザーメニュー" }).click();
		await shot(page, "user", "12-user-menu");
		await page.getByRole("button", { name: "ユーザーメニュー" }).click();
		await nav(page, "社員マスタ");
		await expect(page.getByRole("region", { name: "あなたのプロフィール" })).toBeVisible();
		await shot(page, "user", "13-profile");
		await menu(page, "ヘルプ");
		await expect(page.getByRole("heading", { name: "ヘルプ", level: 1 })).toBeVisible();
		await shot(page, "user", "14-help");
		await signOut(page);
	});

	await test.step("管理者", async () => {
		await signIn(page, ADMIN);
		await expect(page.getByRole("heading", { name: /全社の評価シート/ })).toBeVisible();
		await shot(page, "admin", "01-overview");

		await nav(page, "社員マスタ");
		await expect(page.getByRole("heading", { name: "社員一覧" })).toBeVisible();
		await shot(page, "admin", "02-employees");
		await page.getByRole("button", { name: "評価構造" }).click();
		await shot(page, "admin", "03-structure");
		await page.getByRole("button", { name: "リスト" }).click();
		await page.getByRole("button", { name: "招待コードを一括発行" }).click();
		await confirm(page, "未登録の社員に招待コードをまとめて発行しますか？", "まとめて発行");
		await expect(page.getByRole("textbox", { name: "招待コードの一覧" })).toBeVisible();
		await shot(page, "admin", "04-bulk-invitations");
		await page.locator(".master-invitation").getByRole("button", { name: "閉じる" }).click();
		await confirm(page, "招待コードの一覧を閉じますか？", "閉じる");
		await page.getByRole("button", { name: "山本 大輔さんの招待コードを発行する" }).click();
		await expect(page.getByRole("textbox", { name: "招待コード" })).toBeVisible();
		await shot(page, "admin", "05-invitation");

		await menu(page, "設定");
		await shot(page.getByRole("region", { name: "評価点の配点" }), "admin", "08-allocation");
		await shot(page.getByRole("region", { name: "チャレンジ目標の数" }), "admin", "09-max-goals");
		await shot(page.getByRole("region", { name: "通知メール" }), "admin", "10-smtp");

		// 期を上期・下期に分けて追加し、上期を始める(2026年度 下期は同時に締められる)
		const periods = page.getByRole("region", { name: "評価期間", exact: true });
		await expect(periods).toBeVisible();
		await periods.getByLabel("期の名前").fill("2027年度");
		await periods.getByLabel("開始日").fill("2027-04-01");
		await periods.getByLabel("終了日").fill("2028-03-31");
		await periods.getByLabel("半期(上期・下期)").check();
		await expect(periods.getByRole("list", { name: "追加される評価期間" })).toBeVisible();
		await shot(periods, "admin", "06-periods");
		await periods.getByRole("button", { name: "追加する" }).click();
		await periods.getByRole("button", { name: "2027年度 上期を開始する" }).click();
		const switching = page.getByRole("dialog", { name: /を締めて/ });
		await expect(switching).toBeVisible();
		await shot(page, "admin", "07-period-switch");
		await switching.getByRole("button", { name: "締めて、次の期間を開始する" }).click();
		await expect(periods.getByRole("row", { name: /2027年度 上期/ })).toContainText("実施中");

		// 導入処理: 実施中の評価期間(2027年度 上期)へのデータ取込。確かめるところまで
		await menu(page, "導入処理");
		await expect(page.getByRole("link", { name: /データ取込/ })).toBeVisible();
		await shot(page, "admin", "11-setup");
		await page.getByRole("link", { name: /データ取込/ }).click();
		const goals = page.getByLabel("目標", { exact: true });
		await goals.setInputFiles("e2e/fixtures/manual-goals-with-error.csv");
		await page.getByRole("button", { name: "内容を確認" }).click();
		const importErrors = page.getByRole("alert").filter({ hasText: "取り込めません" });
		await expect(importErrors).toBeVisible();
		await shot(importErrors, "admin", "12-import-errors");
		await goals.setInputFiles("e2e/fixtures/manual-goals.csv");
		await page.getByRole("button", { name: "内容を確認" }).click();
		const ready = page.getByRole("region", { name: "3. 取り込む" });
		await expect(ready).toBeVisible();
		await shot(ready, "admin", "13-import-ready");

		// 遡及処理: 締めた 2026年度 下期の、佐藤さんのシートを直す
		await menu(page, "遡及処理");
		await page
			.getByRole("navigation", { name: "締め済みの評価期間" })
			.getByRole("button", { name: "2026年度 下期" })
			.click();
		await page.getByRole("button", { name: "佐藤 三郎さんのシートを直す" }).click();
		const goal = page.getByRole("group", { name: "チャレンジ目標 1" });
		await goal
			.getByLabel("達成状況")
			.fill("入力チェック表を作って運用した。3月の手戻りは月8件になった");
		await goal.getByLabel("二次評価").selectOption("4");
		await page.getByLabel(/修正の理由/).fill("3月の集計の誤りが見つかり、評価会議で見直した");
		await shot(page.locator(".correction-editor"), "admin", "14-retroactive");
		await page.getByRole("button", { name: /修正内容を確認/ }).click();
		const correcting = page.getByRole("dialog", { name: "締めたシートを修正しますか？" });
		await expect(correcting).toBeVisible();
		await shot(page, "admin", "15-retroactive-confirm");
		await correcting.getByRole("button", { name: "修正を記録する" }).click();
		await expect(page.getByRole("region", { name: /このシートの修正の記録\(2件\)/ })).toBeVisible();
		await signOut(page);
	});

	await test.step("利用者: 前の評価期間の目標と締め後修正", async () => {
		await signIn(page, "RELEASE004");
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		const previous = page.locator("details.previous-goals");
		await expect(previous).toContainText("受注処理の手戻り");
		await shot(previous, "user", "15-previous-goals");
		await page.getByRole("link", { name: "TYPA 評価シート一覧へ" }).click();
		await page
			.getByRole("navigation", { name: "評価期間" })
			.getByRole("button", { name: "2026年度 下期" })
			.click();
		await page
			.getByRole("link", { name: /一般職/ })
			.first()
			.click();
		const notice = page.locator(".correction-notice");
		await expect(notice).toContainText("締め後修正があります");
		await shot(notice, "user", "16-corrections");
	});
});

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const inline = (text: string) => {
	// コード表記の中身(「***」など)を、太字の記法と取り違えないよう先に退避する
	const codes: string[] = [];
	return escapeHtml(text)
		.replace(/`(.+?)`/g, (_, code) => `${codes.push(code) - 1}`)
		.replace(
			/!\[(.*?)\]\((.*?)\)/g,
			(_, alt, src) =>
				`<img alt="${alt}" src="data:image/png;base64,${readFileSync(`docs/manual/${src}`).toString("base64")}">`,
		)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\[(.+?)\]\(.+?\)/g, "$1")
		.replace(/(\d+)/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
};

const list = (block: string, tag: "ol" | "ul", marker: RegExp) =>
	`<${tag}>${block
		.split("\n")
		.map((line) => `<li>${inline(line.replace(marker, ""))}</li>`)
		.join("")}</${tag}>`;

// ponytail: docs/manual/*.md で使っている書式だけを変換する。表現を増やしたら、ここも足す
function toHtml(markdown: string) {
	return markdown
		.replace(/\r\n/g, "\n")
		.trim()
		.split(/\n{2,}/)
		.map((block) => {
			if (block.startsWith("```")) {
				return `<pre>${escapeHtml(block.replace(/^```.*\n|\n```$/g, ""))}</pre>`;
			}
			const heading = block.match(/^(#{1,3}) (.*)$/);
			if (heading) {
				const level = heading[1].length;
				return `<h${level}>${inline(heading[2])}</h${level}>`;
			}
			if (block.startsWith("> ")) {
				return `<aside>${inline(block.replace(/^> /gm, "").replace(/\n/g, ""))}</aside>`;
			}
			if (block.startsWith("|")) {
				const rows = block
					.split("\n")
					.filter((row) => !/^\|\s*-/.test(row))
					.map((row) =>
						row
							.slice(1, -1)
							.split("|")
							.map((cell) => inline(cell.trim())),
					);
				const [head, ...body] = rows;
				return `<table><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr>${body
					.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
					.join("")}</table>`;
			}
			if (/^\d+\. /.test(block)) {
				return list(block, "ol", /^\d+\. /);
			}
			if (block.startsWith("- ")) {
				return list(block, "ul", /^- /);
			}
			// 日本語の文は改行で区切っても、つなげて読める
			return `<p>${inline(block.replace(/\n/g, ""))}</p>`;
		})
		.join("\n");
}

// 画面と同じ「紙と墨」の落ち着いた組版にする
const PRINT_CSS = `
body { font-family: "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1f2933; font-size: 10.5pt; line-height: 1.75; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 14pt; border-bottom: 1px solid #c9d1d9; padding-bottom: 4pt; margin-top: 24pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin-top: 16pt; break-after: avoid; }
p, li { orphans: 2; widows: 2; }
img { display: block; max-width: 80%; max-height: 120mm; margin: 4pt auto 12pt; border: 1px solid #d6dbe0; border-radius: 4px; break-inside: avoid; }
aside { border-left: 3px solid #9aa5b1; background: #f6f7f8; padding: 6pt 10pt; margin: 8pt 0 12pt; break-inside: avoid; }
pre { background: #f3f4f6; padding: 8pt 12pt; font-size: 9.5pt; white-space: pre-wrap; }
code { background: #f3f4f6; padding: 0 3pt; border-radius: 3px; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 14pt; break-inside: avoid; }
th, td { border: 1px solid #d6dbe0; padding: 4pt 8pt; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
`;

for (const [manual, title] of MANUALS) {
	test(`${manual} manual PDF`, async ({ page }) => {
		const body = toHtml(readFileSync(`docs/manual/${manual}.md`, "utf8"));
		await page.setContent(
			`<!doctype html><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style>${body}`,
		);
		await page.pdf({
			path: `docs/manual/${manual}.pdf`,
			format: "A4",
			margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
			displayHeaderFooter: true,
			headerTemplate: "<span></span>",
			footerTemplate: `<div style="width:100%;text-align:center;font-size:8pt;color:#6b7280">${title}　<span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
		});
	});
}
