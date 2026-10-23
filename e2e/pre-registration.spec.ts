import { expect, type Page, test } from "@playwright/test";
import { ADMIN, fillPreRegistration, openPreRegistration, restAs, signIn } from "./support";

const RPC = "**/rest/v1/rpc/pre_register_employee";

async function submit(page: Page) {
	await page.getByRole("button", { name: "仮登録する", exact: true }).click();
	await page.getByRole("dialog").getByRole("button", { name: "仮登録する", exact: true }).click();
}

async function saved(employeeNo: string) {
	const admin = await restAs(1);
	const response = await admin(
		`employees?employee_no=eq.${employeeNo}&select=employee_no,name,career_course,primary_evaluator_id,secondary_evaluator_id,no_secondary_evaluator`,
	);
	expect(response.ok).toBe(true);
	return response.json();
}

async function pickEvaluator(page: Page, label: string, option: string | RegExp) {
	await page.getByRole("combobox", { name: label, exact: true }).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

test("optional evaluators, explicit no-secondary, and an executive are persisted correctly", async ({
	page,
}) => {
	await signIn(page, ADMIN);
	await openPreRegistration(page);
	for (const [employeeNo, course, primary, secondary, expectedSecondary, none] of [
		["E2E_REVIEWED", "一般職", true, /Release test 3\s*RELEASE003/, 900003, false],
		["E2E_PRIMARY_ONLY", "総合職", true, "未設定", null, false],
		["E2E_SECONDARY_ONLY", "総合職", false, /Release test 3\s*RELEASE003/, 900003, false],
		["E2E_NO_SECONDARY", "技能職", true, "なし（一次評価が最終評価）", null, true],
		["E2E_EXECUTIVE", "役員", true, "なし（一次評価が最終評価）", null, false],
	] as const) {
		await test.step(`${course}: ${employeeNo}`, async () => {
			await fillPreRegistration(page, employeeNo, employeeNo);
			if (primary) {
				await pickEvaluator(page, "一次評価者", /Release test 2\s*RELEASE002/);
			}
			await pickEvaluator(page, "二次評価者", secondary);
			// 役員に切り替える前の選択が残っていても、評価者は送信しない。
			await page
				.getByRole("combobox", { name: "キャリアコース", exact: true })
				.selectOption(course);
			if (course === "役員") {
				await expect(page.getByRole("combobox", { name: "一次評価者", exact: true })).toHaveCount(
					0,
				);
				await expect(page.getByRole("combobox", { name: "二次評価者", exact: true })).toHaveCount(
					0,
				);
			}
			await page.getByRole("button", { name: "仮登録する", exact: true }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toContainText(`キャリアコース ${course}・等級 Release verification`);
			if (course === "役員") {
				await expect(dialog).not.toContainText("一次評価者");
			} else {
				await expect(dialog).toContainText(`一次評価者 ${primary ? "Release test 2" : "未設定"}`);
				await expect(dialog).toContainText(
					`二次評価者 ${none ? "なし" : expectedSecondary ? "Release test 3" : "未設定"}`,
				);
			}
			await dialog.getByRole("button", { name: "仮登録する", exact: true }).click();
			await expect(page.getByRole("status").filter({ hasText: `${employeeNo}さん` })).toBeVisible();
			await expect(page.getByLabel("社員番号", { exact: true })).toHaveValue("");
			expect(await saved(employeeNo)).toEqual([
				{
					employee_no: employeeNo,
					name: employeeNo,
					career_course: course,
					primary_evaluator_id: course === "役員" || !primary ? null : 900002,
					secondary_evaluator_id: expectedSecondary,
					no_secondary_evaluator: none,
				},
			]);
			await expect(page.getByRole("combobox", { name: "一次評価者", exact: true })).toHaveValue(
				"未設定",
			);
			await expect(page.getByRole("combobox", { name: "二次評価者", exact: true })).toHaveValue(
				"未設定",
			);
		});
	}
});

test("each required field prevents submission when omitted", async ({ page }) => {
	await signIn(page, ADMIN);
	await openPreRegistration(page);
	const writes: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/rpc/pre_register_employee")) {
			writes.push(request.url());
		}
	});
	for (const label of ["社員番号", "氏名", "キャリアコース", "等級"]) {
		await test.step(`${label}は必須`, async () => {
			await fillPreRegistration(page, "E2E_REQUIRED", "必須確認");
			const field = page.getByRole(
				label === "社員番号" || label === "氏名" ? "textbox" : "combobox",
				{ name: label, exact: true },
			);
			if (label === "キャリアコース" || label === "等級") {
				await field.selectOption("");
			} else {
				await field.fill("");
			}
			await page.getByRole("button", { name: "仮登録する", exact: true }).click();
			await expect(field).toBeFocused();
			expect(
				await field.evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
			).toBe(true);
			await expect(page.getByRole("dialog")).toHaveCount(0);
		});
	}
	expect(writes).toEqual([]);
	expect(await saved("E2E_REQUIRED")).toEqual([]);
});

test("invalid employee numbers, blank names, and case-insensitive duplicates preserve input without writing", async ({
	page,
}) => {
	await signIn(page, ADMIN);
	await openPreRegistration(page);
	const writes: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/rpc/pre_register_employee")) {
			writes.push(request.url());
		}
	});
	for (const [employeeNo, name, message] of [
		["社員001", "入力不正", "社員番号は半角英数字・ハイフン・アンダースコアで入力してください。"],
		["NEW 001", "入力不正", "社員番号は半角英数字・ハイフン・アンダースコアで入力してください。"],
		["E2E_BLANK", "　", "氏名を入力してください。"],
		["release001", "重複確認", "社員番号 RELEASE001 はRelease test 1さんが使っています。"],
	] as const) {
		await fillPreRegistration(page, employeeNo, name);
		await submit(page);
		await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
		await expect(page.getByLabel("社員番号", { exact: true })).toHaveValue(employeeNo);
		await expect(page.getByLabel("氏名", { exact: true })).toHaveValue(name);
		await expect(page.getByRole("button", { name: "仮登録する", exact: true })).toBeEnabled();
		await page.getByRole("alert").getByRole("button", { name: "通知を閉じる" }).click();
		await expect(page.getByRole("alert")).toHaveCount(0);
	}
	expect(writes).toEqual([]);
	expect(await saved("E2E_BLANK")).toEqual([]);
	expect(await saved(ADMIN)).toEqual([expect.objectContaining({ name: "Release test 1" })]);
});

test("cancelling confirmation keeps the form and does not register the employee", async ({
	page,
}) => {
	await signIn(page, ADMIN);
	await openPreRegistration(page);
	await fillPreRegistration(page, "E2E_CANCELLED", "キャンセル確認");
	await pickEvaluator(page, "一次評価者", /Release test 2\s*RELEASE002/);
	await pickEvaluator(page, "二次評価者", "なし（一次評価が最終評価）");
	await page.getByRole("button", { name: "仮登録する", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("社員番号 E2E_CANCELLED");
	await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByLabel("社員番号", { exact: true })).toHaveValue("E2E_CANCELLED");
	await expect(page.getByLabel("氏名", { exact: true })).toHaveValue("キャンセル確認");
	await expect(page.getByRole("combobox", { name: "キャリアコース", exact: true })).toHaveValue(
		"総合職",
	);
	await expect(page.getByRole("combobox", { name: "等級", exact: true })).toHaveValue("9001");
	await expect(page.getByRole("combobox", { name: "一次評価者", exact: true })).toHaveValue(
		"Release test 2",
	);
	await expect(page.getByRole("combobox", { name: "二次評価者", exact: true })).toHaveValue(
		"なし（一次評価が最終評価）",
	);
	expect(await saved("E2E_CANCELLED")).toEqual([]);
});

test("a failed RPC preserves the form, unlocks controls, and permits a successful retry", async ({
	page,
}) => {
	await signIn(page, ADMIN);
	await openPreRegistration(page);
	await fillPreRegistration(page, "E2E_RETRY", "再試行確認");
	let release!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(
		RPC,
		async (route) => {
			await released;
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({ message: "Temporary failure" }),
			});
		},
		{ times: 1 },
	);
	try {
		const requested = page.waitForRequest(RPC);
		await submit(page);
		await requested;
		await expect(
			page.getByRole("button", { name: "登録しています...", exact: true }),
		).toBeDisabled();
		for (const label of [
			"社員番号",
			"氏名",
			"キャリアコース",
			"等級",
			"一次評価者",
			"二次評価者",
		]) {
			await expect(
				page.getByRole(label === "社員番号" || label === "氏名" ? "textbox" : "combobox", {
					name: label,
					exact: true,
				}),
			).toBeDisabled();
		}
	} finally {
		release();
	}
	await expect(page.getByRole("alert")).toContainText("仮登録できませんでした。");
	await expect(page.getByLabel("社員番号", { exact: true })).toHaveValue("E2E_RETRY");
	await expect(page.getByLabel("氏名", { exact: true })).toHaveValue("再試行確認");
	await expect(page.getByRole("combobox", { name: "キャリアコース", exact: true })).toHaveValue(
		"総合職",
	);
	await expect(page.getByRole("combobox", { name: "等級", exact: true })).toHaveValue("9001");
	await expect(page.getByRole("button", { name: "仮登録する", exact: true })).toBeEnabled();
	expect(await saved("E2E_RETRY")).toEqual([]);
	await submit(page);
	await expect(page.getByRole("status")).toContainText("再試行確認さん(E2E_RETRY)を仮登録しました");
	await expect(page.getByLabel("社員番号", { exact: true })).toHaveValue("");
	expect(await saved("E2E_RETRY")).toEqual([expect.objectContaining({ name: "再試行確認" })]);
});

for (const [role, n] of [
	["Reviewer", 2],
	["Employee", 4],
] as const) {
	test(`${role} cannot open the form or bypass it through the RPC`, async ({ page }) => {
		await signIn(page, `RELEASE00${n}`);
		await expect(page.getByRole("heading", { name: "評価シート一覧" })).toBeVisible();
		await page.getByRole("button", { name: "ユーザーメニュー" }).click();
		await expect(page.getByRole("link", { name: "導入処理", exact: true })).toHaveCount(0);
		await page.goto("/setup/employees");
		await expect(
			page.getByText("導入処理は Admin のみ利用できます。", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "仮登録する", exact: true })).toHaveCount(0);
		const api = await restAs(n);
		const employeeNo = `E2E_DENIED_${n}`;
		const response = await api("rpc/pre_register_employee", {
			p_employee_no: employeeNo,
			p_name: "権限なし",
			p_grade_id: 9001,
			p_career_course: "総合職",
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "42501" });
		expect(await saved(employeeNo)).toEqual([]);
	});
}
