// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountController } from "../controllers/AccountController";
import DashboardLayout from "./DashboardLayout";

afterEach(cleanup);

it("shows the bell for requests in the top bar", async () => {
	const controller = {
		currentUser: vi.fn().mockResolvedValue(null),
		signOut: vi.fn(),
	} as unknown as AccountController;
	const inbox = {
		load: vi.fn().mockResolvedValue({ unreadCount: 3, items: [] }),
		markRead: vi.fn(),
		markAllRead: vi.fn(),
	};
	const view = render(() => (
		<MemoryRouter>
			<Route path="*" component={() => <DashboardLayout controller={controller} inbox={inbox} />} />
		</MemoryRouter>
	));
	const topBar = await view.findByRole("banner");
	expect(await within(topBar).findByRole("button", { name: "通知（未読 3 件）" })).toBeTruthy();
});

it.each([true, false])(
	"shows privileged operations immediately below corrections only for Admin (%s)",
	async (allowed) => {
		const controller = {
			currentUser: vi.fn().mockResolvedValue({
				name: "管理者",
				canCorrectClosedSheets: allowed,
				canRunPrivilegedOperations: allowed,
			}),
			signOut: vi.fn(),
		} as unknown as AccountController;
		const inbox = {
			load: vi.fn().mockResolvedValue({ unreadCount: 0, items: [] }),
			markRead: vi.fn(),
			markAllRead: vi.fn(),
		};
		const view = render(() => (
			<MemoryRouter>
				<Route
					path="*"
					component={() => <DashboardLayout controller={controller} inbox={inbox} />}
				/>
			</MemoryRouter>
		));
		await view.findByText("管理者");
		fireEvent.click(view.getByRole("button", { name: "ユーザーメニュー" }));
		if (allowed) {
			const links = view.getAllByRole("link").map((link) => link.textContent);
			expect(links[links.indexOf("遡及処理") + 1]).toBe("特権操作");
			expect(view.getByRole("link", { name: "特権操作" }).getAttribute("href")).toBe("/privileged");
		} else {
			expect(view.queryByRole("link", { name: "特権操作" })).toBeNull();
		}
	},
);
