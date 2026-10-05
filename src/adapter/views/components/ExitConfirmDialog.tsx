import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Component, onCleanup, onMount } from "solid-js";
import { confirmAction, hasUnsavedChanges } from "../feedback";

/** 保存していない入力があるときだけ、ウィンドウを閉じる前に確認する。 */
const ExitConfirmDialog: Component = () => {
	onMount(() => {
		if (!isTauri()) {
			return;
		}

		const appWindow = getCurrentWindow();
		let unlisten: (() => void) | undefined;

		appWindow
			.onCloseRequested(async (event) => {
				// 確認が終わるまでネイティブのクローズ処理を必ず止める。
				// confirm後にだけpreventDefaultする公式サンプル通りだと、
				// 確認OK時にウィンドウが閉じない実装差があるため、明示的にdestroy()する。
				event.preventDefault();

				const confirmed =
					!hasUnsavedChanges() ||
					(await confirmAction({
						title: "保存していない変更があります",
						message: "このまま終了すると、入力中の内容は失われます。",
						confirmLabel: "保存せずに終了",
						cancelLabel: "編集を続ける",
						tone: "danger",
					}));
				if (confirmed) {
					await appWindow.destroy();
				}
			})
			.then((fn) => {
				unlisten = fn;
			});

		onCleanup(() => {
			unlisten?.();
		});
	});

	return null;
};

export default ExitConfirmDialog;
