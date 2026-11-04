import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import { type Component, createSignal } from "solid-js";
import {
	applyFontSize,
	DEFAULT_FONT_SIZE,
	getStoredFontSize,
	MAX_FONT_SIZE,
	MIN_FONT_SIZE,
} from "../fontSize";

const FontSizeMenuControls: Component = () => {
	const [size, setSize] = createSignal(getStoredFontSize() ?? DEFAULT_FONT_SIZE);

	const changeSize = (next: number) => {
		applyFontSize(next);
		setSize(next);
	};

	return (
		<fieldset class="user-menu-font-size">
			<legend class="visually-hidden">文字サイズ</legend>
			<span aria-hidden="true">文字サイズ</span>
			<div>
				<button
					type="button"
					aria-label="文字を小さくする"
					title="文字を小さくする"
					disabled={size() <= MIN_FONT_SIZE}
					onClick={() => changeSize(size() - 1)}
				>
					<Minus size={16} />
				</button>
				<output aria-live="polite">{size()}px</output>
				<button
					type="button"
					aria-label="文字を大きくする"
					title="文字を大きくする"
					disabled={size() >= MAX_FONT_SIZE}
					onClick={() => changeSize(size() + 1)}
				>
					<Plus size={16} />
				</button>
			</div>
		</fieldset>
	);
};

export default FontSizeMenuControls;
