import { A } from "@solidjs/router";
import Bell from "lucide-solid/icons/bell";
import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
	Inbox,
	InboxItem,
	NotificationInboxController,
} from "../../controllers/NotificationInboxController";
import { showToast } from "../feedback";
import { formatDateTime } from "../format";

interface NotificationBellProps {
	controller: Pick<NotificationInboxController, "load" | "markRead" | "markAllRead">;
}

/** 画面上部のベル。自分あての評価の依頼(アプリ内通知)を知らせる。 */
const NotificationBell: Component<NotificationBellProps> = (props) => {
	const [inbox, setInbox] = createSignal<Inbox>({ unreadCount: 0, items: [] });
	const [open, setOpen] = createSignal(false);
	const [failed, setFailed] = createSignal(false);
	let container!: HTMLDivElement;
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
		setOpen(false);
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

	// 画面に戻ったときに、届いた依頼を読み直す。一覧はベルの外を押すか Esc で閉じる。
	// 一覧の中で押したボタンは直後に消えることがある(すべて既読にする)ので、画面から消えた要素は中とみなす
	const refresh = () => void load();
	const closeOutside = (event: MouseEvent) => {
		const target = event.target as Node;
		if (target.isConnected && !container.contains(target)) {
			setOpen(false);
		}
	};
	const closeOnEscape = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			setOpen(false);
		}
	};
	onMount(() => {
		void load();
		window.addEventListener("focus", refresh);
		document.addEventListener("click", closeOutside);
		document.addEventListener("keydown", closeOnEscape);
	});
	onCleanup(() => {
		mounted = false;
		window.removeEventListener("focus", refresh);
		document.removeEventListener("click", closeOutside);
		document.removeEventListener("keydown", closeOnEscape);
	});

	return (
		<div class="notification-bell" ref={container}>
			<button
				type="button"
				class="notification-trigger"
				aria-label={inbox().unreadCount > 0 ? `通知（未読 ${inbox().unreadCount} 件）` : "通知"}
				aria-controls="notification-panel"
				aria-expanded={open()}
				onClick={() => {
					if (!open()) {
						void load();
					}
					setOpen(!open());
				}}
			>
				<Bell size={18} />
				<Show when={inbox().unreadCount > 0}>
					<span class="notification-badge" aria-hidden="true">
						{inbox().unreadCount}
					</span>
				</Show>
			</button>
			<Show when={open()}>
				<section id="notification-panel" class="notification-panel" aria-label="通知">
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
							<For each={inbox().items}>
								{(item) => (
									<li>
										<A
											href={item.href}
											class="notification-item"
											classList={{ unread: item.unread }}
											onClick={() => void read(item)}
										>
											<span class="notification-title">
												<Show when={item.unread}>
													<span class="notification-unread">未読</span>
												</Show>
												{item.title}
											</span>
											<span class="notification-detail">{item.detail}</span>
											<time class="notification-time" datetime={item.createdAt}>
												{formatDateTime(item.createdAt)}
											</time>
										</A>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</section>
			</Show>
		</div>
	);
};

export default NotificationBell;
