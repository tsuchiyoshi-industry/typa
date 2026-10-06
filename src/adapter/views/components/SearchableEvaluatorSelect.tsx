import { Check, ChevronDown, Search } from "lucide-solid";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";

export interface EvaluatorOption {
	value: string;
	name: string;
	employeeNo?: string;
}

const SearchableEvaluatorSelect: Component<{
	label: string;
	value: string;
	options: EvaluatorOption[];
	disabled: boolean;
	saving: boolean;
	onPick: (value: string) => Promise<boolean>;
}> = (props) => {
	const id = createUniqueId();
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
	const filtered = createMemo(() => {
		const term = query().trim().normalize("NFKC").toLocaleLowerCase();
		return props.options.filter((option) =>
			`${option.name} ${option.employeeNo ?? ""}`
				.normalize("NFKC")
				.toLocaleLowerCase()
				.includes(term),
		);
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
		place();
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
		setActive((prev) =>
			wasOpen
				? Math.max(0, Math.min(filtered().length - 1, prev + direction))
				: direction > 0
					? 0
					: Math.max(0, filtered().length - 1),
		);
		document.getElementById(`${id}-option-${active()}`)?.scrollIntoView?.({ block: "nearest" });
	};
	createEffect(() => {
		if (!open()) {
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
		onCleanup(() => {
			document.removeEventListener("pointerdown", outside);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		});
	});
	return (
		<div class="evaluator-combobox" classList={{ unset: !props.value, saving: props.saving }}>
			<input
				ref={input}
				role="combobox"
				aria-label={props.label}
				aria-expanded={open()}
				aria-controls={`${id}-list`}
				aria-autocomplete="list"
				aria-activedescendant={open() && filtered().length ? `${id}-option-${active()}` : undefined}
				aria-busy={props.saving}
				autocomplete="off"
				disabled={props.disabled}
				placeholder="評価者を選択"
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
				<Portal>
					<div ref={panel} class="evaluator-menu" style={position()}>
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
										aria-selected={props.value === option.value}
										classList={{ active: active() === index() }}
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
							<p class="evaluator-no-results">一致する評価者がいません</p>
						</Show>
					</div>
				</Portal>
			</Show>
		</div>
	);
};

export default SearchableEvaluatorSelect;
