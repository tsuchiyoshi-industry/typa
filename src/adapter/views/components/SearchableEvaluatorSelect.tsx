import { Portal } from "@solidjs/web";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	flush,
	Show,
} from "solid-js";
import { Check, ChevronDown, Search } from "./icons";
import { supportsAnchoredPopover } from "./topbarPopover";

export interface EvaluatorOption {
	value: string;
	name: string;
	employeeNo?: string;
}

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
/** 検索に使う文字列。同じ候補は同じオブジェクトで渡されるので、一度だけ作る。 */
const searchTexts = new WeakMap<EvaluatorOption, string>();
const searchText = (option: EvaluatorOption): string => {
	let text = searchTexts.get(option);
	if (text === undefined) {
		text = normalize(`${option.name} ${option.employeeNo ?? ""}`);
		searchTexts.set(option, text);
	}
	return text;
};

const SearchableEvaluatorSelect: Component<{
	label: string;
	value: string;
	options: EvaluatorOption[];
	disabled: boolean;
	saving: boolean;
	/** 選ぶものの呼び名。既定は「評価者」。 */
	noun?: string;
	onPick: (value: string) => Promise<boolean>;
}> = (props) => {
	const noun = () => props.noun ?? "評価者";
	const id = createUniqueId();
	const anchor = supportsAnchoredPopover ? `--evaluator-${CSS.escape(id)}` : undefined;
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [active, setActive] = createSignal(0);
	const [position, setPosition] = createSignal({
		top: "0px",
		left: "0px",
		width: "300px",
		"max-height": "320px",
	});
	let input!: HTMLInputElement;
	let panel: HTMLDivElement | undefined;
	const selected = () => props.options.find((option) => option.value === props.value);
	// 一覧の行の数だけこの部品が並ぶので、候補の絞り込みはメニューを開いている間だけ行う
	const filtered = createMemo(() => {
		if (!open()) {
			return [];
		}
		const term = normalize(query().trim());
		return props.options.filter((option) => searchText(option).includes(term));
	});
	const place = () => {
		if (!open()) {
			return;
		}
		const rect = input.getBoundingClientRect();
		const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
		const below = window.innerHeight - rect.bottom - 16;
		const above = rect.top - 16;
		const up = below < 220 && above > below;
		const height = Math.min(320, Math.max(100, up ? above : below));
		setPosition({
			top: `${up ? Math.max(12, rect.top - height - 6) : rect.bottom + 6}px`,
			left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
			width: `${width}px`,
			"max-height": `${height}px`,
		});
	};
	const begin = () => {
		if (props.disabled || open()) {
			return;
		}
		setQuery("");
		setActive(0);
		setOpen(true);
		// 2.0 では書いた値が次の flush まで読めない。続けて押されても、上の確認で止める
		flush();
		if (anchor) {
			panel?.showPopover({ source: input });
		} else {
			place();
		}
	};
	const choose = async (option: EvaluatorOption) => {
		setOpen(false);
		if (option.value !== props.value) {
			await props.onPick(option.value);
		}
		// Restore focus without reopening the menu after save/cancel/failure.
		if (input.isConnected) {
			input.focus();
			setOpen(false);
		}
	};
	const move = (direction: number) => {
		const wasOpen = open();
		begin();
		const next = wasOpen
			? Math.max(0, Math.min(filtered().length - 1, active() + direction))
			: direction > 0
				? 0
				: Math.max(0, filtered().length - 1);
		setActive(next);
		// 書き込んだ active は次の flush まで古いので、移動先の番号を直接使う。
		document.getElementById(`${id}-option-${next}`)?.scrollIntoView?.({ block: "nearest" });
	};
	// 開いている間だけ、外を押したら閉じ、画面が動いたら付け直す。閉じたら後片付けで外す
	createEffect(open, (isOpen) => {
		if (!isOpen || anchor) {
			return;
		}
		const outside = (event: PointerEvent) => {
			if (
				!input.parentElement?.contains(event.target as Node) &&
				!panel?.contains(event.target as Node)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", outside);
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			document.removeEventListener("pointerdown", outside);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	});
	return (
		<div class={["evaluator-combobox", { unset: !props.value, saving: props.saving }]}>
			<input
				ref={input}
				style={anchor ? { "anchor-name": anchor } : undefined}
				role="combobox"
				aria-label={props.label}
				aria-expanded={open() ? "true" : "false"}
				aria-controls={`${id}-list`}
				aria-autocomplete="list"
				aria-activedescendant={open() && filtered().length ? `${id}-option-${active()}` : undefined}
				aria-busy={props.saving ? "true" : "false"}
				autocomplete="off"
				disabled={props.disabled}
				placeholder={`${noun()}を選択`}
				value={open() ? query() : (selected()?.name ?? "未設定")}
				onFocus={begin}
				onClick={begin}
				onInput={(event) => {
					setQuery(event.currentTarget.value);
					setActive(0);
				}}
				onBlur={(event) => {
					if (!panel?.contains(event.relatedTarget as Node)) {
						setOpen(false);
					}
				}}
				onKeyDown={(event) => {
					if (event.isComposing) {
						return;
					}
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						move(event.key === "ArrowDown" ? 1 : -1);
					}
					if (event.key === "Escape") {
						event.preventDefault();
						setOpen(false);
					}
					if (event.key === "Enter" && open()) {
						event.preventDefault();
						const option = filtered()[active()];
						if (option) {
							void choose(option);
						}
					}
				}}
			/>
			<ChevronDown size={15} class="evaluator-chevron" aria-hidden="true" />
			<Show when={open()}>
				<Portal mount={input.closest("dialog") ?? document.body}>
					<div
						ref={panel}
						class="evaluator-menu"
						popover={anchor ? "auto" : undefined}
						style={anchor ? { "position-anchor": anchor } : position()}
						onBeforeToggle={(event) => {
							if (event.newState === "closed") {
								setOpen(false);
							}
						}}
					>
						<div class="evaluator-search-hint">
							<Search size={14} />
							氏名・社員番号で検索<span>{filtered().length}名</span>
						</div>
						<div id={`${id}-list`} role="listbox" aria-label={props.label}>
							<For each={filtered()}>
								{(option, index) => (
									<button
										type="button"
										id={`${id}-option-${index()}`}
										role="option"
										aria-selected={props.value === option.value ? "true" : "false"}
										class={{ active: active() === index() }}
										tabindex="-1"
										onPointerDown={(event) => event.preventDefault()}
										onMouseEnter={() => setActive(index())}
										onClick={() => void choose(option)}
									>
										<span>
											<strong>{option.name}</strong>
											<Show when={option.employeeNo}>
												<small>{option.employeeNo}</small>
											</Show>
										</span>
										<Show when={props.value === option.value}>
											<Check size={16} aria-hidden="true" />
										</Show>
									</button>
								)}
							</For>
						</div>
						<Show when={!filtered().length}>
							<p class="evaluator-no-results">一致する{noun()}がいません</p>
						</Show>
					</div>
				</Portal>
			</Show>
		</div>
	);
};

export default SearchableEvaluatorSelect;
