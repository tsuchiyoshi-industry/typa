import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { type Component, onCleanup, onMount } from "solid-js";

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

				const confirmed = await ask("本当に終了しますか？", {
					title: "typaを終了",
					kind: "warning",
					okLabel: "終了する",
					cancelLabel: "キャンセル",
				});
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
