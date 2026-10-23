import type {
	InAppNotification,
	NotificationInboxRepository,
} from "../../domain/repositories/NotificationInboxRepository";

/** ベルの一覧に出す 1 件。 */
export interface InboxItem {
	id: number;
	title: string;
	detail: string;
	href: string;
	createdAt: string;
	unread: boolean;
}

export interface Inbox {
	unreadCount: number;
	items: InboxItem[];
}

const WORDING: Record<InAppNotification["kind"], { done: string; next: string }> = {
	submitted: { done: "評価シートが提出されました", next: "一次評価をお願いします" },
	first_evaluated: { done: "一次評価が確定しました", next: "二次評価をお願いします" },
};

/** 画面上部のベル。自分あての評価の依頼を、読んだかどうかとあわせて出す。 */
export class NotificationInboxController {
	constructor(private readonly repository: NotificationInboxRepository) {}

	async load(): Promise<Inbox> {
		const notices = await this.repository.findMine();
		return {
			unreadCount: notices.filter((notice) => !notice.read).length,
			items: notices.map((notice) => ({
				id: notice.id,
				title: `${notice.employeeName}さんの${WORDING[notice.kind].done}`,
				detail: `${WORDING[notice.kind].next}（${notice.periodName}）`,
				href: `/sheet/${notice.sheetId}`,
				createdAt: notice.createdAt,
				unread: !notice.read,
			})),
		};
	}

	markRead(id: number): Promise<void> {
		return this.repository.markRead([id]);
	}

	markAllRead(): Promise<void> {
		return this.repository.markAllRead();
	}
}
