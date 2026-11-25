import { type Component, createSignal, For, onFlush, onSettled, Show } from "solid-js";
import type {
	Inbox,
	InboxItem,
	NotificationInboxController,
} from "../../controllers/NotificationInboxController";
import { showToast } from "../feedback";
import { formatDateTime } from "../format";
import { Bell } from "./icons";

import { createTopbarPopover, supportsAnchoredPopover } from "./topbarPopover";

interface NotificationBellProps {
	controller: Pick<NotificationInboxController, "load" | "markRead" | "markAllRead">;
}

/** 画面上部のベル。自分あての評価の依頼(アプリ内通知)を知らせる。 */
const NotificationBell: Component<NotificationBellProps> = (props) => {
	const [inbox, setInbox] = createSignal<Inbox>({ unreadCount: 0, items: [] });
	const [failed, setFailed] = createSignal(false);
	let mounted = true;
	// 既読にするたびに増やす。それより前に始めた読み込みの結果は古いので使わない
	let changes = 0;

	// 読めなかったことを「通知なし」に見せない
	const load = async () => {
		const startedAt = changes;
		try {
			const next = await props.controller.load();
			if (mounted && startedAt === changes) {
				setInbox(next);
				setFailed(false);
			}
		} catch {
			if (mounted) {
				setFailed(true);
			}
		}
	};

	// 既読は画面を先に変え、保存できなければ読み直して元に戻す
	const markLocally = (isRead: (item: InboxItem) => boolean) => {
		changes++;
		setInbox((current) => {
			const items = current.items.map((item) =>
				item.unread && isRead(item) ? { ...item, unread: false } : item,
			);
			return { unreadCount: items.filter((item) => item.unread).length, items };
		});
	};
	const read = async (item: InboxItem) => {
		// リンクを押すとページを移る。移り終わるのを待たずに、一覧はすぐ閉じる
		onFlush(notices.close);
		if (!item.unread) {
			return;
		}
		markLocally((entry) => entry.id === item.id);
		try {
			await props.controller.markRead(item.id);
		} catch {
			await load();
		}
	};
	const readAll = async () => {
		markLocally(() => true);
		try {
			await props.controller.markAllRead();
		} catch {
			showToast("error", "通知を既読にできませんでした。時間をおいて再度お試しください。");
			await load();
		}
	};

	const refresh = () => void load();
	const notices = createTopbarPopover("notification-panel", undefined, refresh);
	onSettled(() => {
		void load();
		window.addEventListener("focus", refresh);
		return () => {
			mounted = false;
			window.removeEventListener("focus", refresh);
		};
	});

	return (
		<div class="notification-bell">
			<button
				type="button"
				class="notification-trigger"
				aria-label={inbox().unreadCount > 0 ? `通知（未読 ${inbox().unreadCount} 件）` : "通知"}
				{...notices.button}
			>
				<Bell size={18} />
				<Show when={inbox().unreadCount > 0}>
					<span class="notification-badge" aria-hidden="true">
						{inbox().unreadCount}
					</span>
				</Show>
			</button>
			<section
				{...notices.panel}
				class="notification-panel"
				aria-label="通知"
				hidden={!supportsAnchoredPopover && !notices.open()}
			>
				<Show when={notices.open()}>
					<Show when={inbox().unreadCount > 0}>
						<button type="button" class="notification-read-all" onClick={() => void readAll()}>
							すべて既読にする
						</button>
					</Show>
					<Show when={failed()}>
						<div class="inline-alert" role="alert">
							<span>通知を読み込めませんでした</span>
							<button type="button" class="secondary-action" onClick={() => void load()}>
								再読み込み
							</button>
						</div>
					</Show>
					<Show
						when={inbox().items.length > 0}
						fallback={
							<Show when={!failed()}>
								<p class="notification-empty">新しい通知はありません</p>
							</Show>
						}
					>
						<ul class="notification-list">
							<For each={inbox().items} keyed={(item) => item.id}>
								{(item) => (
									<li>
										<a
											href={item().href}
											class={["notification-item", { unread: item().unread }]}
											onClick={() => void read(item())}
										>
											<span class="notification-title">
												<Show when={item().unread}>
													<span class="notification-unread">未読</span>
												</Show>
												{item().title}
											</span>
											<span class="notification-detail">{item().detail}</span>
											<time class="notification-time" datetime={item().createdAt}>
												{formatDateTime(item().createdAt)}
											</time>
										</a>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Show>
			</section>
		</div>
	);
};

export default NotificationBell;
