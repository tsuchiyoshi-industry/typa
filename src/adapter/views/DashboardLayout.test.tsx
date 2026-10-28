// @vitest-environment happy-dom
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountController } from "../controllers/AccountController";
import DashboardLayout from "./DashboardLayout";
import { clearUnsavedChanges, settleConfirm, trackUnsaved } from "./feedback";

afterEach(() => {
	cleanup();
	clearUnsavedChanges();
	settleConfirm(false);
});

const inbox = () => ({
	load: vi.fn().mockResolvedValue({ unreadCount: 0, items: [] }),
	markRead: vi.fn(),
	markAllRead: vi.fn(),
});

const reviewer = async () => ({ name: "山田", canReview: true });

function setup(path = "/", currentUser: () => Promise<unknown> = reviewer) {
	const controller = {
		currentUser: vi.fn(currentUser),
		signOut: vi.fn(),
	} as unknown as AccountController & { signOut: ReturnType<typeof vi.fn> };
	const history = createMemoryHistory();
	history.set({ value: path, replace: true, scroll: false });
	const view = render(() => (
		<MemoryRouter history={history}>
			<Route
				path="*"
				component={() => (
					<DashboardLayout controller={controller} inbox={inbox()}>
						<p>本文</p>
					</DashboardLayout>
				)}
			/>
		</MemoryRouter>
	));
	const nav = () => view.getByRole("navigation", { name: "メインナビゲーション" });
	const current = () =>
		within(nav())
			.getAllByRole("link")
			.filter((link) => link.getAttribute("aria-current") === "page")
			.map((link) => link.textContent);
	return { ...view, controller, history, nav, current };
}

it("shows the bell for requests in the top bar", async () => {
	const view = render(() => (
		<MemoryRouter>
			<Route
				path="*"
				component={() => (
					<DashboardLayout
						controller={
							{ currentUser: vi.fn().mockResolvedValue(null) } as unknown as AccountController
						}
						inbox={{ ...inbox(), load: vi.fn().mockResolvedValue({ unreadCount: 3, items: [] }) }}
					/>
				)}
			/>
		</MemoryRouter>
	));
	const topBar = await view.findByRole("banner");
	expect(await within(topBar).findByRole("button", { name: "通知（未読 3 件）" })).toBeTruthy();
});

it.each([
	["/", ["評価シート"]],
	// シートは一覧から開くので、シートの中も「評価シート」が現在地
	["/sheet/12", ["評価シート"]],
	["/sheet/new", ["評価シート"]],
	["/review?period=3&sheet=8", ["部下の評価"]],
	["/employee-master", ["社員マスタ"]],
	// ナビにない画面(ユーザーメニューから開く画面・取り込み・存在しない URL)では、どれも選ばない
	["/settings", []],
	["/sheet-import", []],
	["/no-such-page", []],
])("marks exactly the section of %s as the current page", async (path, expected) => {
	const view = setup(path);
	await within(view.nav()).findByRole("link", { name: "部下の評価" });
	expect(view.current()).toEqual(expected);
	// 見た目の現在地(class)と、読み上げの現在地(aria-current)はずれない
	for (const link of within(view.nav()).getAllByRole("link")) {
		expect(link.classList.contains("active")).toBe(link.getAttribute("aria-current") === "page");
	}
});

it("moves the current mark when navigating, and does not keep two marks", async () => {
	const view = setup("/");
	fireEvent.click(await within(view.nav()).findByRole("link", { name: "部下の評価" }));
	await waitFor(() => expect(view.current()).toEqual(["部下の評価"]));
	view.history.set({ value: "/sheet/5" });
	await waitFor(() => expect(view.current()).toEqual(["評価シート"]));
});

it("opens the narrow-screen menu and closes it on Escape, outside clicks and after choosing", async () => {
	const view = setup("/");
	const toggle = view.getByRole("button", { name: "メニュー" });
	const expanded = () => toggle.getAttribute("aria-expanded");
	expect(expanded()).toBe("false");

	fireEvent.click(toggle);
	expect(expanded()).toBe("true");
	expect(view.nav().classList.contains("nav-open")).toBe(true);
	fireEvent.keyDown(document, { key: "Escape" });
	expect(expanded()).toBe("false");

	fireEvent.click(toggle);
	fireEvent.click(view.getByText("本文"));
	expect(expanded()).toBe("false");

	// メニューの中を押しても閉じない(リンクを押したときだけ閉じる)
	fireEvent.click(toggle);
	fireEvent.click(view.nav());
	expect(expanded()).toBe("true");
	fireEvent.click(within(view.nav()).getByRole("link", { name: "社員マスタ" }));
	expect(expanded()).toBe("false");
	await waitFor(() => expect(view.current()).toEqual(["社員マスタ"]));
});

it("keeps the top bar usable when the current user cannot be read", async () => {
	const view = setup("/", () => Promise.reject(new Error("offline")));
	await waitFor(() => expect(view.controller.currentUser).toHaveBeenCalled());
	fireEvent.click(view.getByRole("button", { name: "ユーザーメニュー" }));
	// 名前も権限も分からないので、権限の要る項目は出さず、ログアウトとヘルプは残す
	expect(view.getByRole("button", { name: "ログアウト" })).toBeTruthy();
	expect(view.getByRole("link", { name: "ヘルプ" })).toBeTruthy();
	expect(view.queryByRole("link", { name: "設定" })).toBeNull();
	expect(view.queryByRole("link", { name: "遡及処理" })).toBeNull();
	expect(within(view.nav()).queryByRole("link", { name: "部下の評価" })).toBeNull();
	expect(view.current()).toEqual(["評価シート"]);
});

it("hides 部下の評価 from people who cannot be evaluators, even on /review", async () => {
	const view = setup("/review", async () => ({ name: "社員", canReview: false }));
	await view.findByText("社員");
	expect(within(view.nav()).queryByRole("link", { name: "部下の評価" })).toBeNull();
	expect(view.current()).toEqual([]);
});

it("does not sign out while the user keeps unsaved input", async () => {
	const view = setup("/", async () => ({ name: "山田" }));
	const [dirty] = createSignal(true);
	const dispose = createRoot((dispose) => {
		trackUnsaved("test", dirty);
		return dispose;
	});
	await view.findByText("山田");
	fireEvent.click(view.getByRole("button", { name: "ユーザーメニュー" }));
	fireEvent.click(view.getByRole("button", { name: "ログアウト" }));
	// 確認で「編集を続ける」を選ぶ
	settleConfirm(false);
	await Promise.resolve();
	await Promise.resolve();
	expect(view.controller.signOut).not.toHaveBeenCalled();
	dispose();
});

it("closes the user menu with Escape and when the other menu opens", async () => {
	const view = setup("/", async () => ({ name: "山田" }));
	await view.findByText("山田");
	const trigger = view.getByRole("button", { name: "ユーザーメニュー" });
	fireEvent.click(trigger);
	expect(trigger.getAttribute("aria-expanded")).toBe("true");
	fireEvent.keyDown(document, { key: "Escape" });
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	fireEvent.click(trigger);
	fireEvent.click(view.getByRole("button", { name: "メニュー" }));
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it.each([true, false])(
	"offers 遡及処理, the single page for changing or deleting sheets, only to Admin (%s)",
	async (allowed) => {
		const view = setup("/", async () => ({ name: "管理者", canCorrectClosedSheets: allowed }));
		await view.findByText("管理者");
		fireEvent.click(view.getByRole("button", { name: "ユーザーメニュー" }));
		const links = view.getAllByRole("link").map((link) => link.textContent);
		expect(links.includes("遡及処理")).toBe(allowed);
		// 特権操作は遡及処理にまとめた
		expect(links).not.toContain("特権操作");
	},
);
