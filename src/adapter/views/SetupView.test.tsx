// @vitest-environment happy-dom
import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountController } from "../controllers/AccountController";
import SetupView from "./SetupView";

afterEach(cleanup);

const show = (currentUser: () => Promise<unknown>) =>
	render(() => (
		<MemoryRouter>
			<Route
				path="/"
				component={() => (
					<SetupView
						controller={{ currentUser: vi.fn(currentUser) } as unknown as AccountController}
					/>
				)}
			/>
		</MemoryRouter>
	));

it("explains a failure to read who is signed in, instead of breaking the page", async () => {
	const view = show(async () => {
		throw new Error("JWT expired");
	});
	await view.findByText("読み込めませんでした。(JWT expired)");
	expect(view.queryByRole("link", { name: /データ取込/ })).toBeNull();
});

it("offers the setup tasks to an Admin only", async () => {
	const employee = show(async () => ({ canRunSetup: false }));
	await employee.findByText("導入処理は Admin のみ利用できます。");
	cleanup();
	const admin = show(async () => ({ canRunSetup: true }));
	expect(await admin.findByRole("link", { name: /データ取込/ })).toBeTruthy();
});
