// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ check: vi.fn(), confirmDiscard: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("../feedback", () => ({ confirmDiscard: mocks.confirmDiscard }));

import AutoUpdateNotification from "./AutoUpdateNotification";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

it("checks unsaved work after download and never installs when the user continues editing", async () => {
	let finish!: () => void;
	const update = {
		version: "1.0.0",
		currentVersion: "0.9.12",
		close: vi.fn().mockResolvedValue(undefined),
		download: vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		),
		install: vi.fn().mockResolvedValue(undefined),
	};
	mocks.check.mockResolvedValue(update);
	mocks.confirmDiscard.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
	render(() => <AutoUpdateNotification />);
	fireEvent.click(await screen.findByRole("button", { name: "更新して再起動" }));
	await waitFor(() => expect(update.download).toHaveBeenCalledOnce());
	expect(mocks.confirmDiscard).not.toHaveBeenCalled();
	finish();
	await waitFor(() => expect(mocks.confirmDiscard).toHaveBeenCalledOnce());
	expect(update.install).not.toHaveBeenCalled();
	expect(mocks.relaunch).not.toHaveBeenCalled();
	fireEvent.click(await screen.findByRole("button", { name: "更新して再起動" }));
	await waitFor(() => expect(update.install).toHaveBeenCalledOnce());
	expect(update.download).toHaveBeenCalledOnce();
	expect(mocks.confirmDiscard).toHaveBeenCalledTimes(2);
});
