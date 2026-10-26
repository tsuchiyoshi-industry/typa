import { expect, it, vi } from "vitest";
import type { InAppNotification } from "../../domain/repositories/NotificationInboxRepository";
import { NotificationInboxController } from "./NotificationInboxController";

const notice = (overrides: Partial<InAppNotification> = {}): InAppNotification => ({
	id: 7,
	sheetId: 100,
	kind: "submitted",
	employeeName: "山田 太郎",
	periodName: "2026年度 上期",
	createdAt: "2026-10-23T05:00:00Z",
	read: false,
	...overrides,
});
function setup(notices: InAppNotification[] = []) {
	const repository = {
		findMine: vi.fn().mockResolvedValue(notices),
		markRead: vi.fn().mockResolvedValue(undefined),
		markAllRead: vi.fn().mockResolvedValue(undefined),
	};
	return { repository, controller: new NotificationInboxController(repository) };
}

it("says whose sheet waits for which evaluation, links to it, and counts the unread", async () => {
	const { controller } = setup([
		notice({ id: 8, sheetId: 101, kind: "first_evaluated", employeeName: "佐藤 花子" }),
		notice({ read: true }),
	]);
	expect(await controller.load()).toEqual({
		unreadCount: 1,
		items: [
			{
				id: 8,
				title: "佐藤 花子さんの一次評価が確定しました",
				detail: "二次評価をお願いします（2026年度 上期）",
				href: "/sheet/101",
				createdAt: "2026-10-23T05:00:00Z",
				unread: true,
			},
			{
				id: 7,
				title: "山田 太郎さんの一次評価の依頼が届きました",
				detail: "一次評価をお願いします（2026年度 上期）",
				href: "/sheet/100",
				createdAt: "2026-10-23T05:00:00Z",
				unread: false,
			},
		],
	});
});

it("marks one notice or all of them read", async () => {
	const { repository, controller } = setup();
	await controller.markRead(7);
	expect(repository.markRead).toHaveBeenCalledExactlyOnceWith([7]);
	await controller.markAllRead();
	expect(repository.markAllRead).toHaveBeenCalledOnce();
});
