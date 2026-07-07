export type ThemePreference = "light" | "dark";

const STORAGE_KEY = "typa:theme";

function systemPrefersDark(): boolean {
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredThemePreference(): ThemePreference | null {
	const stored = window.localStorage.getItem(STORAGE_KEY);
	return stored === "light" || stored === "dark" ? stored : null;
}

/** 明示的な指定がなければ、OS のテーマ設定に従う。 */
export function resolveEffectiveTheme(preference: ThemePreference | null): ThemePreference {
	return preference ?? (systemPrefersDark() ? "dark" : "light");
}

export function applyThemePreference(preference: ThemePreference): void {
	document.documentElement.setAttribute("data-theme", preference);
	window.localStorage.setItem(STORAGE_KEY, preference);
}

export function watchSystemTheme(onChange: () => void): () => void {
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}
