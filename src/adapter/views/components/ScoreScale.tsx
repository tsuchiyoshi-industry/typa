import { type Component, For } from "solid-js";

interface ScoreScaleProps {
	/** 0 は未評価。 */
	value: number;
	max: number;
	label: string;
	disabled?: boolean;
	onChange: (value: number) => void;
}

/**
 * 1〜max の段階をボタンで選ぶ。選択中をもう一度押しても変わらない(押し直しやダブルクリックで、
 * 気づかないうちに未評価へ戻らないようにする)。入力をやめるときは「キャンセル」で元に戻す。
 */
const ScoreScale: Component<ScoreScaleProps> = (props) => (
	<fieldset class="score-scale" disabled={props.disabled}>
		<legend class="visually-hidden">{props.label}</legend>
		<For each={Array.from({ length: props.max }, (_, index) => index + 1)}>
			{(step) => (
				<button
					type="button"
					class="score-scale__step"
					classList={{ selected: props.value === step, filled: step < props.value }}
					aria-pressed={props.value === step}
					aria-label={`${props.label} ${step}`}
					onClick={() => props.value !== step && props.onChange(step)}
				>
					{step}
				</button>
			)}
		</For>
	</fieldset>
);

export default ScoreScale;
