import { createEffect, createSignal } from "solid-js";

export const supportsAnchoredPopover =
	typeof HTMLElement !== "undefined" &&
	"showPopover" in HTMLElement.prototype &&
	globalThis.CSS?.supports("position-area", "block-end") &&
	CSS.supports("position-try-fallbacks", "flip-block");

/** 広い画面では常に見えるナビもあるため、ネイティブの開閉は必要なときだけ有効にする。 */
export function createTopbarPopover(id: string, enabled = () => true, onOpen?: () => void) {
	const native = () => supportsAnchoredPopover && enabled();
	const [open, setOpen] = createSignal(false);
	let panel: HTMLElement;
	let trigger: HTMLButtonElement;
	const close = () => {
		if (panel?.matches("[popover]")) {
			panel.hidePopover();
		}
		setOpen(false);
	};
	createEffect(
		() => open() && !native(),
		(fallbackOpen) => {
			if (!fallbackOpen) {
				return;
			}
			const outside = (event: MouseEvent) => {
				const target = event.target as Node;
				if (target.isConnected && !panel.contains(target) && !trigger.contains(target)) {
					close();
				}
			};
			const closeOnEscape = (event: KeyboardEvent) => {
				if (event.key === "Escape") {
					close();
				}
			};
			document.addEventListener("click", outside);
			document.addEventListener("keydown", closeOnEscape);
			return () => {
				document.removeEventListener("click", outside);
				document.removeEventListener("keydown", closeOnEscape);
			};
		},
	);
	return {
		open,
		close,
		button: {
			ref: (element: HTMLButtonElement) => {
				trigger = element;
			},
			"aria-controls": id,
			get "aria-expanded"(): "true" | "false" {
				return open() ? "true" : "false";
			},
			get popovertarget() {
				return native() ? id : undefined;
			},
			onClick: () => {
				if (!native()) {
					if (!open()) {
						onOpen?.();
					}
					setOpen(!open());
				}
			},
		},
		panel: {
			id,
			ref: (element: HTMLElement) => {
				panel = element;
			},
			get popover() {
				return native() ? ("auto" as const) : undefined;
			},
			onBeforeToggle: (event: ToggleEvent) => {
				const opening = event.newState === "open";
				setOpen(opening);
				if (opening) {
					onOpen?.();
				}
			},
		},
	};
}
