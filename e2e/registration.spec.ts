import { expect, type Page, test } from "@playwright/test";
import {
	ADMIN,
	fillPreRegistration,
	issueOtp,
	openPreRegistration,
	PASSWORD,
	restAs,
	signIn,
	signOut,
	submitSignIn,
} from "./support";

const NEWCOMER = "RELEASE010";
const NEWCOMER_NAME = "E2E 新入社員";
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
	await test.step("Admin が初期ユーザのタイルから、評価者未設定の社員を仮登録する", async () => {
		await signIn(page, ADMIN);
		await openPreRegistration(page);
		await fillPreRegistration(page, " ＲＥＬＥＡＳＥ０１０ ", ` ${NEWCOMER_NAME} `);
		await page.getByRole("button", { name: "仮登録する", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: `${NEWCOMER_NAME}さんを仮登録しますか？` });
		await expect(dialog).toContainText("一次評価者 未設定");
		await expect(dialog).toContainText("二次評価者 未設定");
		await dialog.getByRole("button", { name: "仮登録する", exact: true }).click();
		await expect(page.getByRole("status")).toContainText(
			`${NEWCOMER_NAME}さん(${NEWCOMER})を仮登録しました`,
		);
		for (const label of ["社員番号", "氏名", "キャリアコース", "等級"]) {
			await expect(
				page.getByRole(label === "社員番号" || label === "氏名" ? "textbox" : "combobox", {
					name: label,
					exact: true,
				}),
			).toHaveValue("");
		}
		const admin = await restAs(1);
		const response = await admin(
			`employees?employee_no=eq.${NEWCOMER}&select=id,employee_no,name,career_course,primary_evaluator_id,secondary_evaluator_id,no_secondary_evaluator`,
		);
		expect(response.ok).toBe(true);
		const [added] = (await response.json()) as { id: number }[];
		expect(added).toEqual({
			id: expect.any(Number),
			employee_no: NEWCOMER,
			name: NEWCOMER_NAME,
			career_course: "総合職",
			primary_evaluator_id: null,
			secondary_evaluator_id: null,
			no_secondary_evaluator: false,
		});
		// 等級とアカウントは表から読めず、見てよい人(Admin)にだけ employee_details が返す
		const details = await admin(
			`rpc/employee_details?employee_id=eq.${added?.id}&select=user_id,registered,grade_id`,
		);
		expect(details.ok).toBe(true);
		expect(await details.json()).toEqual([{ user_id: null, registered: false, grade_id: 9001 }]);
	});
	await test.step("Admin が仮登録した社員の招待コードを一括発行する", async () => {
		await openEmployeeMaster(page);
		await expect(page.getByLabel(`${NEWCOMER_NAME}さんの権限`)).toHaveValue("Employee");
		await page.getByRole("button", { name: "招待コードを一括発行" }).click();
		await expect(page.getByRole("radio", { name: /発行済みの社員を除く/ })).toBeChecked();
		await page.getByRole("dialog").getByRole("button", { name: "まとめて発行" }).click();
		const issued = await page.getByRole("textbox", { name: "招待コードの一覧" }).inputValue();
		const row = issued.split("\n").find((line) => line.startsWith(`${NEWCOMER}\t`));
		invitation = row?.split("\t")[2] ?? "";
		expect(invitation).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

		// 発行済みを除く選択では、期限内のコードを変えない。
		await page.getByRole("button", { name: "閉じる", exact: true }).click();
		await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
		await page.getByRole("button", { name: "招待コードを一括発行" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "まとめて発行" }).click();
		await expect(page.getByText("発行する相手はいません")).toBeVisible();
		// 含める選択なら、期限内でも新しいコードをまとめて渡せる。
		await page.getByRole("button", { name: "招待コードを一括発行" }).click();
		await page.getByRole("radio", { name: /発行済みの社員も含めて新しく発行する/ }).check();
		await page.getByRole("dialog").getByRole("button", { name: "まとめて発行" }).click();
		const renewed = await page.getByRole("textbox", { name: "招待コードの一覧" }).inputValue();
		const nextCode =
			renewed
				.split("\n")
				.find((line) => line.startsWith(`${NEWCOMER}\t`))
				?.split("\t")[2] ?? "";
		expect(nextCode).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
		expect(nextCode).not.toBe(invitation);
		invitation = nextCode;
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

	let temporary = "";
	await test.step("Admin が仮のパスワードを設定すると、前のパスワードは使えなくなる", async () => {
		await signIn(page, ADMIN);
		await openEmployeeMaster(page);
		await page
			.getByRole("combobox", { name: "登録状態で絞り込む" })
			.selectOption({ label: "登録済み" });
		await page
			.getByRole("button", { name: `${NEWCOMER_NAME}さんに仮のパスワードを設定する` })
			.click();
		const dialog = page.getByRole("dialog", { name: `${NEWCOMER_NAME}さんに仮のパスワードを設定` });
		temporary = await dialog.getByRole("textbox", { name: "仮のパスワード" }).inputValue();
		expect(temporary).toMatch(/^[A-Za-z2-9]{10}$/);
		await dialog.getByRole("button", { name: "仮のパスワードを設定" }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByRole("status")).toContainText(
			`${NEWCOMER_NAME}さんに仮のパスワードを設定しました`,
		);
		await signOut(page);

		await signIn(page, NEWCOMER);
		await expect(page.getByRole("alert")).toContainText(
			"社員番号またはパスワードが正しくありません",
		);
	});

	await test.step("本人は仮のパスワードでログインすると、自分のパスワードに変えるまで先へ進めない", async () => {
		await submitSignIn(page, NEWCOMER, temporary);
		await expect(
			page.getByRole("heading", { name: "新しいパスワードを決めてください" }),
		).toBeVisible();
		await page.getByLabel("新しいパスワード", { exact: true }).fill(temporary);
		await page.getByLabel("新しいパスワード（確認）").fill(temporary);
		await page.getByRole("button", { name: "パスワードを変えて始める" }).click();
		await expect(page.getByRole("alert")).toContainText("仮のパスワードとは別の");
		await page.getByLabel("新しいパスワード", { exact: true }).fill(PASSWORD);
		await page.getByLabel("新しいパスワード（確認）").fill(PASSWORD);
		await page.getByRole("button", { name: "パスワードを変えて始める" }).click();
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await signOut(page);

		await signIn(page, NEWCOMER);
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await signOut(page);
	});

	await test.step("Admin が利用停止すると、ログインが断られる", async () => {
		await signIn(page, ADMIN);
		await openEmployeeMaster(page);
		await page.getByRole("button", { name: `${NEWCOMER_NAME}さんの利用を停止する` }).click();
		await page.getByRole("dialog").getByRole("button", { name: "利用を停止" }).click();
		await expect(
			page.getByRole("button", { name: `${NEWCOMER_NAME}さんの利用を再開する` }),
		).toBeVisible();
		await signOut(page);

		await signIn(page, NEWCOMER);
		await expect(page.getByRole("alert")).toContainText("利用が停止されています");
	});
});
