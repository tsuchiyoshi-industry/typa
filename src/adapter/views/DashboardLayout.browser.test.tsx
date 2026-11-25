import "./styles/global.css";
import "./styles/dashboard.css";
import { memoryHistory } from "@solidjs/router";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { routed } from "../../test/router";
import type { AccountController } from "../controllers/AccountController";
import DashboardLayout from "./DashboardLayout";

afterEach(cleanup);

/** App.tsx と同じ枠(.app-shell > .app-frame)に入れて、実際の CSS で測る。 */
async function setup(width: number, path = "/") {
	await page.viewport(width, 600);
	const history = memoryHistory("/");
	history.set({ value: path, replace: true, scroll: false });
	const view = render(() => (
		<div class="app-shell">
			<div class="app-frame">
				{routed(
					() => (
						<DashboardLayout
							controller={
								{
									currentUser: vi.fn().mockResolvedValue({ name: "山田 太郎", canReview: true }),
								} as unknown as AccountController
							}
							inbox={{
								load: vi.fn().mockResolvedValue({ unreadCount: 0, items: [] }),
								markRead: vi.fn(),
								markAllRead: vi.fn(),
							}}
						>
							<p>本文</p>
						</DashboardLayout>
					),
					{ history: history },
				)}
			</div>
		</div>
	));
	await view.findByText("山田 太郎");
	return { ...view, topBar: view.getByRole("banner") };
}

it.each([1280, 1920, 2560])(
	"spans the whole window at %ipx, even past the content width",
	async (width) => {
		const view = await setup(width);
		const box = view.topBar.getBoundingClientRect();
		expect(box.left).toBe(0);
		expect(box.width).toBe(document.documentElement.clientWidth);
		// 本文は読みやすい幅に絞ったまま
		const main = view.getByRole("main").getBoundingClientRect();
		expect(main.width).toBeLessThanOrEqual(1440);
	},
);

it("opens the current section into the page below the top bar", async () => {
	const view = await setup(1280, "/sheet/3");
	const current = view.getByRole("link", { name: "評価シート" });
	const tab = current.getBoundingClientRect();
	const bar = view.topBar.getBoundingClientRect();
	// 現在地の札は下罫の上に立ち(上に紙の余白を残す)、下罫を覆って紙面とつながる
	expect(tab.top).toBeGreaterThan(bar.top);
	expect(tab.bottom).toBeGreaterThanOrEqual(bar.bottom);
	// ロゴ・札・名前の文字は、同じ高さにそろう
	const middle = (element: Element) => {
		const box = element.getBoundingClientRect();
		return Math.round(box.top + box.height / 2);
	};
	const line = middle(current);
	expect(Math.abs(middle(view.getByText("TYPA")) - line)).toBeLessThanOrEqual(1);
	expect(
		Math.abs(middle(view.getByRole("button", { name: "ユーザーメニュー" })) - line),
	).toBeLessThanOrEqual(2);
	expect(getComputedStyle(current).backgroundColor).toBe(
		getComputedStyle(document.body).backgroundColor,
	);
	// ほかの項目は面を持たない
	const other = view.getByRole("link", { name: "部下の評価" });
	expect(getComputedStyle(other).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

it("hides the sections behind the menu button on a narrow window, without sideways scrolling", async () => {
	const view = await setup(360);
	const nav = document.getElementById("main-nav") as HTMLElement;
	expect(getComputedStyle(nav).display).toBe("none");
	fireEvent.click(view.getByRole("button", { name: "メニュー" }));
	expect(getComputedStyle(nav).display).toBe("flex");
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
		document.documentElement.clientWidth,
	);
});

it.each([360, 1280])(
	"anchors and dismisses the account and inbox popovers at %ipx",
	async (width) => {
		const view = await setup(width);
		const account = view.getByRole("button", { name: "ユーザーメニュー" });
		const bell = view.getByRole("button", { name: "通知" });
		await userEvent.click(account);
		const menu = document.getElementById("user-menu") as HTMLElement;
		expect(menu.matches(":popover-open")).toBe(true);
		const box = menu.getBoundingClientRect();
		expect(box.left).toBeGreaterThanOrEqual(0);
		expect(box.right).toBeLessThanOrEqual(width);
		expect(box.top).toBeGreaterThanOrEqual(account.getBoundingClientRect().bottom);
		await userEvent.click(bell);
		expect(menu.matches(":popover-open")).toBe(false);
		const inbox = view.getByRole("region", { name: "通知" });
		expect(inbox.matches(":popover-open")).toBe(true);
		await userEvent.keyboard("{Escape}");
		expect(bell.getAttribute("aria-expanded")).toBe("false");
		await userEvent.click(account);
		await userEvent.click(view.getByRole("link", { name: "TYPA 評価シート一覧へ" }));
		expect(account.getAttribute("aria-expanded")).toBe("false");
	},
);
