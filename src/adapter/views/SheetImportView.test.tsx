// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { SheetImportResult } from "../../domain/repositories/SheetImportRepository";
import type { SheetImportController } from "../controllers/SheetImportController";
import { confirmAction, showToast } from "./feedback";
import SheetImportView from "./SheetImportView";

vi.mock("./feedback", () => ({ confirmAction: vi.fn(), showToast: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const TEMPLATE = { periodName: "26期 上期", employees: [{}, {}], maxGoals: 4 };
const CHECKED: SheetImportResult = {
	errors: [],
	applied: false,
	summary: {
		periodName: "26期 上期",
		employees: 2,
		newSheets: 1,
		replacedSheets: 1,
		goals: 3,
		commonResults: 4,
	},
};
function setup(template: Promise<unknown> = Promise.resolve(TEMPLATE)) {
	const controller = {
		loadTemplate: vi.fn(() => template),
		saveTemplate: vi.fn().mockResolvedValue("C:/26期 上期_目標.csv"),
		run: vi.fn(async (_goals: File | null, _common: File | null, apply: boolean) =>
			apply ? { ...CHECKED, applied: true } : CHECKED,
		),
	};
	render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<SheetImportView controller={controller as unknown as SheetImportController} />
				)}
			/>
		</MemoryRouter>
	));
	return controller;
}
const pick = async (label: "目標" | "共通評価", name = "goals.csv") => {
	const input = (await screen.findByText(label, { selector: "span" })).parentElement?.querySelector(
		"input",
	) as HTMLInputElement;
	Object.defineProperty(input, "files", { value: [new File(["x"], name)], configurable: true });
	fireEvent.change(input);
};
const check = () => fireEvent.click(screen.getByRole("button", { name: "内容を確認" }));

it("explains why it cannot import, such as no period in progress, and offers no file to pick", async () => {
	setup(Promise.reject(new Error("実施中の評価期間がありません。")));
	expect(await screen.findByText("実施中の評価期間がありません。")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "内容を確認" })).toBeNull();
});

it("checks only once a file is picked, and writes nothing while checking", async () => {
	const controller = setup();
	await screen.findByText(/実施中の評価期間「26期 上期」・対象 2/);
	expect((screen.getByRole("button", { name: "内容を確認" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	await pick("目標");
	check();
	await screen.findByRole("heading", { name: "3. 取り込む" });
	expect(controller.run).toHaveBeenCalledExactlyOnceWith(expect.any(File), null, false);
});

it("lists every error with its file and Excel line, and offers no import", async () => {
	const controller = setup();
	controller.run.mockResolvedValue({
		errors: [
			{ file: "goals", line: 3, message: "社員番号 E9 は対象にいません。" },
			{ file: null, line: null, message: "Admin のみ操作できます。" },
		],
		summary: null,
		applied: false,
	});
	await pick("目標");
	check();
	const alert = await screen.findByRole("alert");
	expect(alert.textContent).toContain("誤りが 2件あります");
	expect([...alert.querySelectorAll("tbody tr")].map((row) => row.textContent)).toEqual([
		"目標3社員番号 E9 は対象にいません。",
		"——Admin のみ操作できます。",
	]);
	expect(screen.queryByRole("button", { name: "取り込む" })).toBeNull();
});

it("imports only after a confirmation that warns about replaced sheets", async () => {
	const controller = setup();
	await pick("目標");
	await pick("共通評価", "common.csv");
	check();
	fireEvent.click(await screen.findByRole("button", { name: "取り込む" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		details: ["新しく作るシート 1枚", "内容を置き換えるシート 1枚"],
		tone: "danger",
	});
	// 断れば何も書かない
	expect(controller.run).toHaveBeenCalledOnce();

	vi.mocked(confirmAction).mockResolvedValue(true);
	fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
	await screen.findByRole("heading", { name: "取り込みました" });
	expect(controller.run).toHaveBeenLastCalledWith(expect.any(File), expect.any(File), true);
	expect(showToast).toHaveBeenCalledWith("success", "取り込みました。", "メールは送っていません。");
	expect(screen.queryByRole("button", { name: "取り込む" })).toBeNull();
});

it("forgets the previous check when a file is picked again", async () => {
	setup();
	await pick("目標");
	check();
	await screen.findByRole("button", { name: "取り込む" });
	await pick("目標", "fixed.csv");
	expect(screen.queryByRole("button", { name: "取り込む" })).toBeNull();
});

it.each([
	[
		"saves the template where the user chose",
		"C:/26期 上期_目標.csv",
		["success", "目標のテンプレートを保存しました。", "C:/26期 上期_目標.csv"],
	],
	["says nothing when the save dialog is cancelled", null, null],
	[
		"says why the template could not be saved",
		new Error("disk full"),
		["error", "テンプレートを保存できませんでした。", "disk full"],
	],
] as const)("%s", async (_label, outcome, toast) => {
	const controller = setup();
	if (outcome instanceof Error) {
		controller.saveTemplate.mockRejectedValue(outcome);
	} else {
		controller.saveTemplate.mockResolvedValue(outcome);
	}
	fireEvent.click(await screen.findByRole("button", { name: "目標のテンプレート" }));
	await waitFor(() => expect(controller.saveTemplate).toHaveBeenCalledWith("goals", TEMPLATE));
	await Promise.resolve();
	if (toast) {
		await waitFor(() => expect(showToast).toHaveBeenCalledWith(...toast));
	} else {
		expect(showToast).not.toHaveBeenCalled();
	}
});
