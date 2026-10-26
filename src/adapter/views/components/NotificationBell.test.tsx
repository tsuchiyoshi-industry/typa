// @vitest-environment happy-dom
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Inbox, InboxItem } from "../../controllers/NotificationInboxController";
import { showToast } from "../feedback";
import { formatDateTime } from "../format";
import NotificationBell from "./NotificationBell";

vi.mock("../feedback", () => ({ showToast: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
	id: 7,
	title: "山田 太郎さんの一次評価の依頼が届きました",
	detail: "一次評価をお願いします（2026年度 上期）",
	href: "/sheet/100",
	createdAt: "2026-10-23T05:00:00Z",
	unread: true,
	...overrides,
});
const inbox = (items: InboxItem[]): Inbox => ({
	unreadCount: items.filter((entry) => entry.unread).length,
	items,
});
/** 既読にした結果を、次の読み込みに返す(DB と同じふるまい)。 */
function setup(items: InboxItem[] = [item()], load?: () => Promise<Inbox>) {
	let stored = items;
	const controller = {
		load: vi.fn<() => Promise<Inbox>>(load ?? (async () => inbox(stored))),
		markRead: vi.fn(async (id: number) => {
			stored = stored.map((entry) => (entry.id === id ? { ...entry, unread: false } : entry));
		}),
		markAllRead: vi.fn(async () => {
			stored = stored.map((entry) => ({ ...entry, unread: false }));
		}),
	};
	const history = createMemoryHistory();
	history.set({ value: "/", replace: true, scroll: false });
	const view = render(() => (
		<MemoryRouter history={history}>
			<Route path="*" component={() => <NotificationBell controller={controller} />} />
		</MemoryRouter>
	));
	return { ...view, controller, history };
}

it("shows how many requests are unread, and no badge when none are", async () => {
	const view = setup([item(), item({ id: 8 }), item({ id: 9, unread: false })]);
	const bell = await view.findByRole("button", { name: "通知（未読 2 件）" });
	expect(within(bell).getByText("2")).toBeTruthy();
	cleanup();
	const quiet = setup([item({ unread: false })]);
	const read = await quiet.findByRole("button", { name: "通知" });
	expect(read.querySelector(".notification-badge")).toBeNull();
});

it("lists each request with whether it was read and when it came", async () => {
	const view = setup([
		item(),
		item({ id: 8, title: "佐藤 花子さんの一次評価が確定しました", unread: false }),
	]);
	fireEvent.click(await view.findByRole("button", { name: "通知（未読 1 件）" }));
	const list = view.getByRole("region", { name: "通知" });
	const links = within(list).getAllByRole("link");
	expect(links).toHaveLength(2);
	expect(links[0].textContent).toContain("山田 太郎さんの一次評価の依頼が届きました");
	expect(links[0].textContent).toContain("一次評価をお願いします（2026年度 上期）");
	expect(links[0].textContent).toContain("未読");
	expect(links[0].textContent).toContain(formatDateTime("2026-10-23T05:00:00Z"));
	expect(links[1].textContent).not.toContain("未読");
	cleanup();
	const empty = setup([]);
	fireEvent.click(await empty.findByRole("button", { name: "通知" }));
	expect(empty.getByText("新しい通知はありません")).toBeTruthy();
});

it("opens the sheet of a request, marks it read, and counts one fewer", async () => {
	const view = setup([item(), item({ id: 8, href: "/sheet/101", unread: false })]);
	fireEvent.click(await view.findByRole("button", { name: "通知（未読 1 件）" }));
	const links = within(view.getByRole("region", { name: "通知" })).getAllByRole("link");
	fireEvent.click(links[0]);
	await waitFor(() => expect(view.history.get()).toBe("/sheet/100"));
	expect(view.controller.markRead).toHaveBeenCalledExactlyOnceWith(7);
	expect(view.queryByRole("region", { name: "通知" })).toBeNull();
	expect(view.getByRole("button", { name: "通知" })).toBeTruthy();

	fireEvent.click(view.getByRole("button", { name: "通知" }));
	fireEvent.click(within(view.getByRole("region", { name: "通知" })).getAllByRole("link")[1]);
	await waitFor(() => expect(view.history.get()).toBe("/sheet/101"));
	expect(view.controller.markRead).toHaveBeenCalledOnce();
});

it("still opens the sheet when the notice could not be marked read", async () => {
	const view = setup();
	view.controller.markRead.mockRejectedValueOnce(new Error("offline"));
	fireEvent.click(await view.findByRole("button", { name: "通知（未読 1 件）" }));
	fireEvent.click(within(view.getByRole("region", { name: "通知" })).getByRole("link"));
	await waitFor(() => expect(view.history.get()).toBe("/sheet/100"));
	// 既読にできなかったので、未読のまま数える
	await waitFor(() => expect(view.getByRole("button", { name: "通知（未読 1 件）" })).toBeTruthy());
});

it("marks every request read at once, only while some are unread", async () => {
	const view = setup([item(), item({ id: 8 })]);
	fireEvent.click(await view.findByRole("button", { name: "通知（未読 2 件）" }));
	fireEvent.click(view.getByRole("button", { name: "すべて既読にする" }));
	await waitFor(() => expect(view.controller.markAllRead).toHaveBeenCalledOnce());
	expect(view.getByRole("button", { name: "通知" })).toBeTruthy();
	expect(view.queryByRole("button", { name: "すべて既読にする" })).toBeNull();
	expect(within(view.getByRole("region", { name: "通知" })).queryByText("未読")).toBeNull();
});

it("puts the unread back and says so when marking all read fails", async () => {
	const view = setup([item(), item({ id: 8 })]);
	view.controller.markAllRead.mockRejectedValueOnce(new Error("offline"));
	fireEvent.click(await view.findByRole("button", { name: "通知（未読 2 件）" }));
	fireEvent.click(view.getByRole("button", { name: "すべて既読にする" }));
	await waitFor(() =>
		expect(showToast).toHaveBeenCalledWith(
			"error",
			expect.stringContaining("既読にできませんでした"),
		),
	);
	expect(view.getByRole("button", { name: "通知（未読 2 件）" })).toBeTruthy();
});

it("says the requests could not be loaded instead of showing an empty list, and retries", async () => {
	const view = setup(
		[],
		// 表示したときと、開いたときの読み込みが失敗する
		vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(inbox([item()])),
	);
	fireEvent.click(await view.findByRole("button", { name: "通知" }));
	const panel = view.getByRole("region", { name: "通知" });
	await waitFor(() => expect(within(panel).getByText("通知を読み込めませんでした")).toBeTruthy());
	expect(within(panel).queryByText("新しい通知はありません")).toBeNull();
	fireEvent.click(within(panel).getByRole("button", { name: "再読み込み" }));
	await waitFor(() => expect(view.getByRole("button", { name: "通知（未読 1 件）" })).toBeTruthy());
});

it("checks for new requests when the window comes back and when the list is opened", async () => {
	const view = setup([]);
	await waitFor(() => expect(view.controller.load).toHaveBeenCalledOnce());
	view.controller.load.mockImplementation(async () => inbox([item()]));
	window.dispatchEvent(new Event("focus"));
	await waitFor(() => expect(view.getByRole("button", { name: "通知（未読 1 件）" })).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "通知（未読 1 件）" }));
	expect(view.controller.load).toHaveBeenCalledTimes(3);
});

it("closes the list with Escape or a click elsewhere", async () => {
	const view = setup();
	fireEvent.click(await view.findByRole("button", { name: "通知（未読 1 件）" }));
	fireEvent.keyDown(document, { key: "Escape" });
	expect(view.queryByRole("region", { name: "通知" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "通知（未読 1 件）" }));
	fireEvent.click(document.body);
	expect(view.queryByRole("region", { name: "通知" })).toBeNull();
});
