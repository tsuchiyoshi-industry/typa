import type { JSX } from "@solidjs/web";
import { Portal } from "@solidjs/web";
import { type Component, createEffect, onSettled } from "solid-js";
import { X } from "./icons";

import { setSheetNotificationMount } from "./sheetNotificationMount";

/** 評価シートと比較表を開くモーダル。閉じてよいかは未保存の編集を持つ呼び出し元が決める。 */
const SheetWindow: Component<{
	/** 読み上げ用の窓の名前。 */
	label: string;
	/** 窓の上端の帯に出す、何を開いているかと、その場でできる操作。 */
	heading: JSX.Element;
	/** ×・Esc・窓の外を押したとき。閉じてよいかは呼び出し側が決める。 */
	onClose: () => void;
	/** 窓を開いたまま中身を入れ替えるときに変える値。変わったら先頭から読めるよう、スクロールを戻す。 */
	contentKey?: unknown;
	children: JSX.Element;
}> = (props) => {
	let dialog!: HTMLDialogElement;
	let pressedBackdrop = false;
	let body: HTMLDivElement | undefined;

	createEffect(
		() => props.contentKey,
		() => {
			if (body) {
				body.scrollTop = 0;
			}
		},
		{ defer: true },
	);

	onSettled(() => {
		const opener = document.activeElement;
		dialog.showModal();
		setSheetNotificationMount(dialog);
		return () => {
			setSheetNotificationMount(null);
			dialog.close();
			if (opener instanceof HTMLElement && opener.isConnected) {
				opener.focus();
			}
		};
	});

	return (
		<Portal>
			<dialog
				ref={dialog}
				class="sheet-window-backdrop"
				aria-label={props.label}
				onCancel={(event) => {
					event.preventDefault();
					props.onClose();
				}}
				onPointerDown={(event) => {
					pressedBackdrop = event.button === 0 && event.target === event.currentTarget;
				}}
				onPointerUp={(event) => {
					if (pressedBackdrop && event.target === event.currentTarget) {
						props.onClose();
					}
					pressedBackdrop = false;
				}}
			>
				<div class="sheet-window">
					<header class="sheet-window__bar">
						{props.heading}
						<button
							type="button"
							class="review-icon-button"
							autofocus
							aria-label="閉じる"
							title="閉じる（Esc）"
							onClick={() => props.onClose()}
						>
							<X size={18} />
						</button>
					</header>
					<div ref={body} class="sheet-window__body">
						{props.children}
					</div>
				</div>
			</dialog>
		</Portal>
	);
};

export default SheetWindow;
