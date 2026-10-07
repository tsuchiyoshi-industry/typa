import Moon from "lucide-solid/icons/moon";
import Sun from "lucide-solid/icons/sun";
import { type Component, createMemo, createSignal, onCleanup } from "solid-js";
import {
	applyThemePreference,
	getStoredThemePreference,
	resolveEffectiveTheme,
	watchSystemTheme,
} from "../theme";

/** ユーザーメニューの中に置くテーマ切替。押してもメニューは閉じず、切り替わった様子をその場で見られる。 */
const ThemeMenuItem: Component = () => {
	const [preference, setPreference] = createSignal(getStoredThemePreference());
	const [systemTick, setSystemTick] = createSignal(0);

	const stopWatching = watchSystemTheme(() => setSystemTick((tick) => tick + 1));
	onCleanup(stopWatching);

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
			<span>{isDark() ? "ライトテーマにする" : "ダークテーマにする"}</span>
		</button>
	);
};

export default ThemeMenuItem;
