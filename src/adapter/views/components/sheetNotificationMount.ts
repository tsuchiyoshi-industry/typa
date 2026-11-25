import { createSignal } from "solid-js";

/** モーダル表示中も通知と更新操作を使えるように、そのダイアログ内に表示する。 */
export const [sheetNotificationMount, setSheetNotificationMount] =
	createSignal<HTMLDialogElement | null>(null);
