// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { SheetImportPeriodDto } from "../../application/dtos/SheetImportPeriodDto";
import type { SheetImportResult } from "../../domain/repositories/SheetImportRepository";
import { routed } from "../../test/router";
import type { SheetImportController, SheetImportRun } from "../controllers/SheetImportController";
import { confirmAction, showToast } from "./feedback";
import SheetImportView from "./SheetImportView";

vi.mock("./feedback", () => ({ confirmAction: vi.fn(), showToast: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const PERIODS: SheetImportPeriodDto[] = [
	{ id: 2, periodName: "26期 上期", stateLabel: "実施中", needsConfirmation: false },
	{ id: 1, periodName: "25期 下期", stateLabel: "締め済み", needsConfirmation: true },
];
const templateOf = (periodId: number) => ({
	periodName: PERIODS.find((period) => period.id === periodId)?.periodName,
	employees: periodId === 2 ? [{}, {}] : [{}, {}, {}],
	maxGoals: 4,
});
const checked = (periodName: string): SheetImportResult => ({
	errors: [],
	applied: false,
	summary: {
		periodName,
		employees: 2,
		newSheets: 1,
		replacedSheets: 1,
		goals: 3,
		commonResults: 4,
	},
});
function setup(
	periods: Promise<SheetImportPeriodDto[]> = Promise.resolve(PERIODS),
	loadTemplate: (periodId: number) => Promise<unknown> = async (periodId) => templateOf(periodId),
) {
	// 確認のダイアログは、テストが答えを決めるまで「取りやめ」(テストの順番に寄りかからない)
	vi.mocked(confirmAction).mockResolvedValue(false);
	const controller = {
		periods: vi.fn(() => periods),
		loadTemplate: vi.fn(loadTemplate),
		saveTemplate: vi.fn().mockResolvedValue("C:/26期 上期_目標.csv"),
		run: vi.fn(async (request: SheetImportRun) => {
			const name = PERIODS.find((period) => period.id === request.periodId)?.periodName ?? "";
			return request.apply ? { ...checked(name), applied: true } : checked(name);
		}),
	};
	render(() =>
		routed(() => <SheetImportView controller={controller as unknown as SheetImportController} />),
	);
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
const choosePeriod = async (periodId: number) => {
	const select = (await screen.findByRole("combobox", { name: "評価期間" })) as HTMLSelectElement;
	select.value = String(periodId);
	fireEvent.change(select);
};
const apply = async () => {
	fireEvent.click(await screen.findByRole("button", { name: "取り込む" }));
	await waitFor(() => expect(confirmAction).toHaveBeenCalled());
};

it.each([
	[
		"the user is not an Admin",
		() => Promise.reject(new Error("データ取込は Admin のみ利用できます。")),
		"データ取込は Admin のみ利用できます。",
	],
	["no period can take an import", () => Promise.resolve([]), /取り込める評価期間がありません/],
] as const)(
	"explains why it cannot import when %s, and offers no file to pick",
	async (_, periods, message) => {
		const controller = setup(periods() as Promise<SheetImportPeriodDto[]>);
		expect(await screen.findByText(message)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "内容を確認" })).toBeNull();
		expect(controller.loadTemplate).not.toHaveBeenCalled();
	},
);

it("explains why the template of the chosen period cannot be read", async () => {
	setup(Promise.resolve(PERIODS), () => Promise.reject(new Error("評価期間が見つかりません。")));
	expect(await screen.findByText("評価期間が見つかりません。")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "内容を確認" })).toBeNull();
});

it("starts on the period in progress, offering the closed ones too", async () => {
	const controller = setup();
	await screen.findByText(/評価期間「26期 上期」・対象 2/);
	expect(controller.loadTemplate).toHaveBeenCalledExactlyOnceWith(2);
	const select = screen.getByRole("combobox", { name: "評価期間" }) as HTMLSelectElement;
	expect([...select.options].map((option) => option.text)).toEqual([
		"26期 上期(実施中)",
		"25期 下期(締め済み)",
	]);
	expect(screen.queryByText(/締め済みの評価期間です/)).toBeNull();
});

it("checks only once a file is picked, and writes nothing while checking", async () => {
	const controller = setup();
	await screen.findByText(/評価期間「26期 上期」・対象 2/);
	expect((screen.getByRole("button", { name: "内容を確認" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	await pick("目標");
	check();
	await screen.findByRole("heading", { name: "3. 取り込む" });
	expect(controller.run).toHaveBeenCalledExactlyOnceWith({
		periodId: 2,
		closedPeriodConfirmed: false,
		goals: expect.any(File),
		common: null,
		apply: false,
	});
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

it("imports into the period in progress only after a confirmation that warns about replaced sheets", async () => {
	const controller = setup();
	await pick("目標");
	await pick("共通評価", "common.csv");
	check();
	await apply();
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		title: "「26期 上期」の評価シートに取り込みます",
		details: ["新しく作るシート 1枚", "内容を置き換えるシート 1枚"],
		tone: "danger",
	});
	// 断れば何も書かない
	expect(controller.run).toHaveBeenCalledOnce();

	vi.mocked(confirmAction).mockResolvedValue(true);
	fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
	await screen.findByRole("heading", { name: "取り込みました" });
	expect(controller.run).toHaveBeenLastCalledWith({
		periodId: 2,
		closedPeriodConfirmed: false,
		goals: expect.any(File),
		common: expect.any(File),
		apply: true,
	});
	expect(showToast).toHaveBeenCalledWith("success", "取り込みました。", "メールは送っていません。");
	expect(screen.queryByRole("button", { name: "取り込む" })).toBeNull();
});

it("warns before writing into a closed period, and says so in the confirmation", async () => {
	const controller = setup();
	await screen.findByText(/評価期間「26期 上期」/);
	await choosePeriod(1);
	await screen.findByText(/評価期間「25期 下期」・対象 3/);
	expect(controller.loadTemplate).toHaveBeenLastCalledWith(1);
	expect(screen.getByText(/締め済みの評価期間です/).textContent).toContain("監査ログ");
	await pick("目標");
	check();
	await screen.findByRole("heading", { name: "3. 取り込む" });
	// 確かめるだけなら、まだ確認は要らない
	expect(controller.run).toHaveBeenLastCalledWith(
		expect.objectContaining({ periodId: 1, closedPeriodConfirmed: false, apply: false }),
	);

	await apply();
	expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({
		title: "締め済みの「25期 下期」に取り込みます",
		tone: "danger",
		note: expect.stringContaining("監査ログ"),
	});
	expect(controller.run).toHaveBeenCalledOnce();

	vi.mocked(confirmAction).mockResolvedValue(true);
	fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
	await screen.findByRole("heading", { name: "取り込みました" });
	expect(controller.run).toHaveBeenLastCalledWith(
		expect.objectContaining({ periodId: 1, closedPeriodConfirmed: true, apply: true }),
	);
});

it("forgets the previous check when another period or file is picked", async () => {
	setup();
	await pick("目標");
	check();
	await screen.findByRole("button", { name: "取り込む" });
	await choosePeriod(1);
	await screen.findByText(/評価期間「25期 下期」/);
	expect(screen.queryByRole("button", { name: "取り込む" })).toBeNull();
	// 選んだファイルはそのまま。確かめ直せる
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
	await waitFor(() => expect(controller.saveTemplate).toHaveBeenCalledWith("goals", templateOf(2)));
	await Promise.resolve();
	if (toast) {
		await waitFor(() => expect(showToast).toHaveBeenCalledWith(...toast));
	} else {
		expect(showToast).not.toHaveBeenCalled();
	}
});
