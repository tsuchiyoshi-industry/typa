import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { isolatedSql } from "../scripts/isolatedApi";
import { ADMIN, signIn, signOut } from "./support";

// 利用者ガイド(docs/user-guide.md)の画面写真を撮り、PDF にする。合否より、資料がそろうことが目的。
const shot = (page: Page, name: string) =>
	// 保存のたびに出るトーストは説明の邪魔なので写さない
	page.screenshot({ path: `docs/user-guide/${name}.png`, style: ".toast-stack{display:none}" });

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

async function score(
	sheet: Locator,
	stage: "一次評価" | "二次評価",
	value: number,
	beforeSave?: () => Promise<unknown>,
) {
	await sheet.getByRole("tabpanel").getByRole("button", { name: "評価を入力" }).click();
	await sheet.getByRole("button", { name: `${stage} ${value}`, exact: true }).click();
	await sheet.getByRole("tabpanel").getByRole("button", { name: "評価を保存" }).click();
	await expect(
		sheet.getByRole("tabpanel").getByRole("button", { name: "評価を入力" }),
	).toBeVisible();

	const common = sheet.getByRole("article").filter({ hasText: "共通評価" });
	await common.getByRole("button", { name: "評価を入力" }).click();
	for (const item of ["報告・連絡・相談", "業務改善"]) {
		await common.getByRole("button", { name: `${item} ${stage} ${value}`, exact: true }).click();
	}
	await beforeSave?.();
	await common.getByRole("button", { name: "評価を保存" }).first().click();
	await expect(common.getByRole("button", { name: "評価を入力" })).toBeVisible();
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

async function openSubordinate(page: Page) {
	await nav(page, "部下の評価");
	await page.getByRole("button", { name: "佐藤 三郎 RELEASE004" }).click();
	return page.getByRole("dialog", { name: "佐藤 三郎 さんの評価シート" });
}

test("user guide screenshots", async ({ page }) => {
	await test.step("ログインと新規登録", async () => {
		await page.goto("/login");
		await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
		await shot(page, "01-login");
		await page.getByRole("button", { name: "新規登録" }).click();
		await page.getByLabel("メールアドレス").fill("watanabe@release.example");
		await page.getByRole("button", { name: "認証コードを受け取る" }).click();
		await expect(page.getByLabel("認証コード")).toBeVisible();
		await shot(page, "02-register");
	});

	await test.step("本人: 作成・記入・提出", async () => {
		await signIn(page, "RELEASE004");
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await shot(page, "03-sheet-list");
		await page.getByRole("link", { name: "新規作成" }).click();
		await page.getByRole("button", { name: "評価シートを作成" }).click();
		await page.getByRole("button", { name: "目標を編集" }).click();
		await page
			.getByRole("textbox", { name: "チャレンジ目標" })
			.fill("受注処理の手戻りを半年で半減する");
		await shot(page, "04-goal");
		await page.getByRole("button", { name: "目標を保存" }).click();
		await page.getByRole("button", { name: "提出する" }).click();
		await expect(page.getByRole("dialog", { name: "評価シートを提出しますか？" })).toBeVisible();
		await shot(page, "05-submit");
		await confirm(page, "評価シートを提出しますか？", "提出する");
		await expect(page.getByText("一次評価者の評価を待っています。")).toBeVisible();
		await shot(page, "06-submitted");
		await signOut(page);
	});

	await test.step("一次評価者", async () => {
		await signIn(page, "RELEASE002");
		await nav(page, "部下の評価");
		await expect(page.getByRole("button", { name: "佐藤 三郎 RELEASE004" })).toBeVisible();
		await shot(page, "07-reviewer");
		const sheet = await openSubordinate(page);
		await score(sheet, "一次評価", 4, () => shot(page, "08-scoring"));
		await sheet.getByRole("button", { name: "一次評価を確定する" }).click();
		await expect(page.getByRole("dialog", { name: "一次評価を確定しますか？" })).toBeVisible();
		await shot(page, "09-confirm");
		await confirm(page, "一次評価を確定しますか？", "一次評価を確定する");
		await sheet.getByRole("button", { name: "閉じる" }).click();
		await signOut(page);
	});

	await test.step("二次評価者", async () => {
		await signIn(page, "RELEASE003");
		const sheet = await openSubordinate(page);
		await score(sheet, "二次評価", 3);
		await sheet.getByRole("button", { name: "評価を確定する" }).click();
		await confirm(page, "評価を確定しますか？", "評価を確定する");
		await sheet.getByRole("button", { name: "閉じる" }).click();
		await expect(page.getByRole("row", { name: /RELEASE004/ })).toContainText("75");
		await shot(page, "10-final");
		await signOut(page);
	});

	await test.step("管理者", async () => {
		await signIn(page, ADMIN);
		await nav(page, "社員マスタ");
		await expect(page.getByRole("heading", { name: "社員一覧" })).toBeVisible();
		await shot(page, "11-employees");
		await menu(page, "設定");
		await expect(page.getByRole("heading", { name: "評価期間", exact: true })).toBeVisible();
		await shot(page, "12-settings");
		await menu(page, "ヘルプ");
		await expect(page.getByRole("heading", { name: "ヘルプ", level: 1 })).toBeVisible();
		await shot(page, "13-help");
	});
});

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const inline = (text: string) =>
	escapeHtml(text)
		.replace(
			/!\[(.*?)\]\((.*?)\)/g,
			(_, alt, src) =>
				`<img alt="${alt}" src="data:image/png;base64,${readFileSync(`docs/${src}`).toString("base64")}">`,
		)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/`(.+?)`/g, "<code>$1</code>")
		.replace(/\[(.+?)\]\(.+?\)/g, "$1");

// ponytail: user-guide.md で使っている書式だけを変換する。表現を増やしたら、ここも足す
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
				const items = block
					.split("\n")
					.map((line) => `<li>${inline(line.replace(/^\d+\. /, ""))}</li>`);
				return `<ol>${items.join("")}</ol>`;
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
p { orphans: 2; widows: 2; }
img { display: block; width: 80%; margin: 4pt auto 12pt; border: 1px solid #d6dbe0; border-radius: 4px; break-inside: avoid; }
pre { background: #f3f4f6; padding: 8pt 12pt; font-size: 9.5pt; white-space: pre-wrap; }
code { background: #f3f4f6; padding: 0 3pt; border-radius: 3px; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 14pt; break-inside: avoid; }
th, td { border: 1px solid #d6dbe0; padding: 4pt 8pt; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
`;

test("user guide PDF", async ({ page }) => {
	const body = toHtml(readFileSync("docs/user-guide.md", "utf8"));
	await page.setContent(`<!doctype html><meta charset="utf-8"><style>${PRINT_CSS}</style>${body}`);
	await page.pdf({
		path: "docs/user-guide.pdf",
		format: "A4",
		margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
		displayHeaderFooter: true,
		headerTemplate: "<span></span>",
		footerTemplate:
			'<div style="width:100%;text-align:center;font-size:8pt;color:#6b7280"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
	});
});
