import { Moon, Sun } from "lucide-solid";
import { type Component, createMemo, createSignal, onCleanup } from "solid-js";
import {
	applyThemePreference,
	getStoredThemePreference,
	resolveEffectiveTheme,
	watchSystemTheme,
} from "../theme";

const ThemeToggleButton: Component = () => {
	const [preference, setPreference] = createSignal(getStoredThemePreference());
	const [systemTick, setSystemTick] = createSignal(0);

	const stopWatching = watchSystemTheme(() => setSystemTick((tick) => tick + 1));
	onCleanup(stopWatching);

	const effectiveTheme = createMemo(() => {
		systemTick();
		return resolveEffectiveTheme(preference());
	});

	const toggle = () => {
		const next = effectiveTheme() === "dark" ? "light" : "dark";
		applyThemePreference(next);
		setPreference(next);
	};

	return (
		<button
			type="button"
			class="theme-toggle-button"
			onClick={toggle}
			aria-label={effectiveTheme() === "dark" ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
			title={effectiveTheme() === "dark" ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
		>
			{effectiveTheme() === "dark" ? <Moon size={18} /> : <Sun size={18} />}
		</button>
	);
};

export default ThemeToggleButton;
