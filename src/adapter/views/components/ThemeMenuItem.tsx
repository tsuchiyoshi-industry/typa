import { type Component, createMemo, createSignal, onSettled } from "solid-js";
import {
	applyThemePreference,
	getStoredThemePreference,
	resolveEffectiveTheme,
	watchSystemTheme,
} from "../theme";
import { Moon, Sun } from "./icons";

/** ユーザーメニューの中に置くテーマ切替。押してもメニューは閉じず、切り替わった様子をその場で見られる。 */
const ThemeMenuItem: Component = () => {
	const [preference, setPreference] = createSignal(getStoredThemePreference());
	const [systemTick, setSystemTick] = createSignal(0);

	onSettled(() => watchSystemTheme(() => setSystemTick((tick) => tick + 1)));

	const isDark = createMemo(() => {
		systemTick();
		return resolveEffectiveTheme(preference()) === "dark";
	});

	const toggle = () => {
		const next = isDark() ? "light" : "dark";
		applyThemePreference(next);
		setPreference(next);
	};

	return (
		<button type="button" class="user-menu-item" onClick={toggle}>
			{isDark() ? <Sun size={18} /> : <Moon size={18} />}
			<span>{isDark() ? "明るくする" : "暗くする"}</span>
		</button>
	);
};

export default ThemeMenuItem;
