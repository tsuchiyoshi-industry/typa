// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

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
	fireEvent.click(await screen.findByRole("button", { name: "今すぐ更新" }));
	await waitFor(() => expect(update.download).toHaveBeenCalledOnce());
	expect(mocks.confirmDiscard).not.toHaveBeenCalled();
	finish();
	await waitFor(() => expect(mocks.confirmDiscard).toHaveBeenCalledOnce());
	expect(update.install).not.toHaveBeenCalled();
	expect(mocks.relaunch).not.toHaveBeenCalled();
	fireEvent.click(await screen.findByRole("button", { name: "今すぐ更新" }));
	await waitFor(() => expect(update.install).toHaveBeenCalledOnce());
	expect(update.download).toHaveBeenCalledOnce();
	expect(mocks.confirmDiscard).toHaveBeenCalledTimes(2);
});

const anUpdate = () => ({
	version: "1.0.1",
	currentVersion: "1.0.0",
	body: "",
	close: vi.fn().mockResolvedValue(undefined),
	download: vi.fn().mockResolvedValue(undefined),
	install: vi.fn().mockResolvedValue(undefined),
});
const THIRTY_MINUTES = 30 * 60 * 1000;

it("checks at start and every 30 minutes, and tells again about an update put off with 'あとで'", async () => {
	vi.useFakeTimers();
	onTestFinished(() => {
		vi.useRealTimers();
	});
	mocks.check.mockResolvedValue(null);
	render(() => <AutoUpdateNotification />);
	await vi.advanceTimersByTimeAsync(0);
	expect(mocks.check).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(THIRTY_MINUTES - 1);
	expect(mocks.check).toHaveBeenCalledOnce();
	mocks.check.mockResolvedValue(anUpdate());
	await vi.advanceTimersByTimeAsync(1);
	expect(mocks.check).toHaveBeenCalledTimes(2);
	expect(screen.getByText("新しいバージョンがあります")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", { name: "あとで" }));
	expect(screen.queryByText("新しいバージョンがあります")).toBeNull();
	await vi.advanceTimersByTimeAsync(THIRTY_MINUTES);
	expect(mocks.check).toHaveBeenCalledTimes(3);
	expect(screen.getByText("新しいバージョンがあります")).toBeTruthy();
});

it("does not check again while an update is downloading", async () => {
	vi.useFakeTimers();
	onTestFinished(() => {
		vi.useRealTimers();
	});
	const update = { ...anUpdate(), download: vi.fn(() => new Promise<void>(() => {})) };
	mocks.check.mockResolvedValue(update);
	render(() => <AutoUpdateNotification />);
	await vi.advanceTimersByTimeAsync(0);
	fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));
	await vi.advanceTimersByTimeAsync(THIRTY_MINUTES * 2);
	expect(mocks.check).toHaveBeenCalledOnce();
	expect(screen.getByText("更新をダウンロードしています")).toBeTruthy();
});

it("says a failed check at start, but keeps quiet about one in the background", async () => {
	vi.useFakeTimers();
	onTestFinished(() => {
		vi.useRealTimers();
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.check.mockResolvedValue(null);
	render(() => <AutoUpdateNotification />);
	await vi.advanceTimersByTimeAsync(0);
	mocks.check.mockRejectedValue(new Error("offline"));
	await vi.advanceTimersByTimeAsync(THIRTY_MINUTES);
	expect(mocks.check).toHaveBeenCalledTimes(2);
	expect(screen.queryByText("更新処理で問題が発生しました")).toBeNull();

	cleanup();
	mocks.check.mockRejectedValue("network unreachable");
	render(() => <AutoUpdateNotification />);
	await vi.advanceTimersByTimeAsync(0);
	expect(screen.getByText("更新処理で問題が発生しました")).toBeTruthy();
	expect(screen.getByText("network unreachable")).toBeTruthy();
});

it.each([
	["download", "ダウンロードできませんでした(署名の検証に失敗)"],
	["install", "インストーラーを起動できませんでした"],
] as const)(
	"explains a failed %s in the words Tauri gave, and restarts nothing",
	async (step, message) => {
		const update = anUpdate();
		update[step].mockRejectedValue(message);
		mocks.check.mockResolvedValue(update);
		mocks.confirmDiscard.mockResolvedValue(true);
		render(() => <AutoUpdateNotification />);
		fireEvent.click(await screen.findByRole("button", { name: "今すぐ更新" }));
		expect(await screen.findByText(message)).toBeTruthy();
		expect(mocks.relaunch).not.toHaveBeenCalled();
	},
);

it("restarts five seconds after installing, unless the user keeps unsaved work", async () => {
	vi.useFakeTimers();
	onTestFinished(() => {
		vi.useRealTimers();
	});
	mocks.check.mockResolvedValue(anUpdate());
	mocks.confirmDiscard.mockResolvedValue(true);
	render(() => <AutoUpdateNotification />);
	await vi.advanceTimersByTimeAsync(0);
	fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));
	await vi.advanceTimersByTimeAsync(0);
	expect(screen.getByText("更新をインストールしました")).toBeTruthy();
	await vi.advanceTimersByTimeAsync(4000);
	expect(mocks.relaunch).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1000);
	expect(mocks.relaunch).toHaveBeenCalledOnce();

	// 秒読みの終わりに入力の途中なら、開き直さずに作業を続けさせる
	cleanup();
	mocks.relaunch.mockClear();
	mocks.confirmDiscard.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
	render(() => <AutoUpdateNotification />);
	await vi.advanceTimersByTimeAsync(0);
	fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));
	await vi.advanceTimersByTimeAsync(5000);
	expect(mocks.relaunch).not.toHaveBeenCalled();
	expect(screen.queryByText("更新をインストールしました")).toBeNull();
});
