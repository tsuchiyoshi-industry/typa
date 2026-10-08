import X from "lucide-solid/icons/x";
import { type Component, createEffect, type JSX, on, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

/**
 * いまの画面の上に浮かべる窓。後ろの画面は見えたまま、操作だけできなくする。
 * 通知と確認ダイアログを窓の上に出せるよう、<dialog> の showModal は使わない
 * (最上位レイヤーに載せると、その外にある通知が窓の下に隠れて押せなくなる)。
 */
const SheetWindow: Component<{
	/** 読み上げ用の窓の名前。 */
	label: string;
	/** 窓の上端の帯に出す、誰のシートかと、その場でできる操作。 */
	heading: JSX.Element;
	/** ×・Esc・窓の外を押したとき。閉じてよいかは呼び出し側が決める。 */
	onClose: () => void;
	/** 窓を開いたまま中身を入れ替えるときに変える値。変わったら先頭から読めるよう、スクロールを戻す。 */
	contentKey?: unknown;
	children: JSX.Element;
}> = (props) => {
	let panel: HTMLDivElement | undefined;
	let body: HTMLDivElement | undefined;

	createEffect(
		on(
			() => props.contentKey,
			() => {
				if (body) {
					body.scrollTop = 0;
				}
			},
			{ defer: true },
		),
	);

	onMount(() => {
		// 通知と確認ダイアログは .app-frame の外にあるので、窓を開いている間も使える
		const behind = document.querySelector<HTMLElement>(".app-frame");
		const opener = document.activeElement;
		behind?.setAttribute("inert", "");
		panel?.focus();
		onCleanup(() => {
			behind?.removeAttribute("inert");
			if (opener instanceof HTMLElement) {
				opener.focus();
			}
		});
	});

	return (
		<Portal>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: 窓の外を押して閉じるのは補助。キーボードには Esc と × がある */}
			<div
				class="sheet-window-backdrop"
				onClick={(event) => event.target === event.currentTarget && props.onClose()}
				onKeyDown={(event) => event.key === "Escape" && props.onClose()}
			>
				<div
					ref={panel}
					class="sheet-window"
					role="dialog"
					aria-modal="true"
					aria-label={props.label}
					tabIndex={-1}
				>
					<header class="sheet-window__bar">
						{props.heading}
						<button
							type="button"
							class="review-icon-button"
							aria-label="評価シートを閉じる"
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
			</div>
		</Portal>
	);
};

export default SheetWindow;
