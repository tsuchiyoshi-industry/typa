const STORAGE_KEY = "typa:font-size";
export const DEFAULT_FONT_SIZE = 16;
export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 22;

export function getStoredFontSize(): number | null {
	const stored = Number(window.localStorage.getItem(STORAGE_KEY));
	return Number.isInteger(stored) && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE
		? stored
		: null;
}

export function applyFontSize(size: number): void {
	if (!Number.isInteger(size) || size < MIN_FONT_SIZE || size > MAX_FONT_SIZE) {
		throw new RangeError("Font size is outside the supported range.");
	}
	document.documentElement.style.fontSize = `${size}px`;
	window.localStorage.setItem(STORAGE_KEY, String(size));
}

export function applyStoredFontSize(): number {
	const size = getStoredFontSize() ?? DEFAULT_FONT_SIZE;
	document.documentElement.style.fontSize = `${size}px`;
	return size;
}
