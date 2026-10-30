// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsaved: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../feedback", () => ({
	hasUnsavedChanges: () => mocks.unsaved,
	confirmAction: vi.fn(),
}));

import ExitConfirmDialog from "./ExitConfirmDialog";

afterEach(cleanup);

const closeTab = () => {
	const event = new Event("beforeunload", { cancelable: true });
	window.dispatchEvent(event);
	return event.defaultPrevented;
};

it("asks the browser to confirm closing the tab only while something is unsaved", () => {
	const view = render(() => <ExitConfirmDialog />);
	mocks.unsaved = false;
	expect(closeTab()).toBe(false);
	mocks.unsaved = true;
	expect(closeTab()).toBe(true);

	// 画面を離れたら、もう止めない
	view.unmount();
	expect(closeTab()).toBe(false);
});
