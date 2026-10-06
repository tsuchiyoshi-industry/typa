import { createEffect, createSignal, onCleanup } from "solid-js";

// --- トースト通知 ---------------------------------------------------

export type ToastKind = "success" | "error" | "info";

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
	detail?: string;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextToastId = 1;

export { toasts };

export function dismissToast(id: number): void {
	setToasts((list) => list.filter((toast) => toast.id !== id));
}

/** エラーは読み落とさないよう、閉じるまで残す。それ以外は数秒で消える。 */
export function showToast(kind: ToastKind, message: string, detail?: string): void {
	const id = nextToastId++;
	setToasts((list) => [...list, { id, kind, message, detail }]);
	if (kind !== "error") {
		window.setTimeout(() => dismissToast(id), 4500);
	}
}

// --- 確認ダイアログ -------------------------------------------------

export interface ConfirmRequest {
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel?: string;
	/** 選択肢のないお知らせは true にする。キャンセルボタンを出さない。 */
	acknowledgeOnly?: boolean;
	/** 取り消せない操作は danger にする。 */
	tone?: "default" | "danger";
}

type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void };

const [pendingConfirm, setPendingConfirm] = createSignal<PendingConfirm | null>(null);

export { pendingConfirm };

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
	return new Promise((resolve) => {
		pendingConfirm()?.resolve(false);
		setPendingConfirm({ ...request, resolve });
	});
}

export function settleConfirm(confirmed: boolean): void {
	const pending = pendingConfirm();
	setPendingConfirm(null);
	pending?.resolve(confirmed);
}

// --- 未保存の変更 ---------------------------------------------------

const [unsavedKeys, setUnsavedKeys] = createSignal<ReadonlySet<string>>(new Set());

export const hasUnsavedChanges = () => unsavedKeys().size > 0;

export function clearUnsavedChanges(): void {
	setUnsavedKeys(new Set<string>());
}

function setUnsaved(key: string, dirty: boolean): void {
	setUnsavedKeys((prev) => {
		if (prev.has(key) === dirty) {
			return prev;
		}
		const next = new Set(prev);
		if (dirty) {
			next.add(key);
		} else {
			next.delete(key);
		}
		return next;
	});
}

/** コンポーネント内で呼ぶ。isDirty が真の間、離脱・終了時に確認が入る。 */
export function trackUnsaved(key: string, isDirty: () => boolean): void {
	createEffect(() => setUnsaved(key, isDirty()));
	onCleanup(() => setUnsaved(key, false));
}

/**
 * 未保存の変更があれば破棄してよいか確認する。なければ即 true。
 * 画面の一部だけを破棄する操作(タブ切り替えなど)は、その部分の状態を isDirty に渡す。
 */
export function confirmDiscard(isDirty = hasUnsavedChanges()): Promise<boolean> {
	if (!isDirty) {
		return Promise.resolve(true);
	}
	return confirmAction({
		title: "保存していない変更があります",
		message: "このまま進むと、入力中の内容は失われます。",
		confirmLabel: "変更を破棄する",
		cancelLabel: "編集を続ける",
		tone: "danger",
	});
}
