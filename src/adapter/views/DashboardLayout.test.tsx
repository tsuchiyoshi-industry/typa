// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, within } from "@solidjs/testing-library";
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
