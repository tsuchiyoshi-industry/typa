import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// global.css の配色トークンが、ライト・ダークの両方で WCAG AA のコントラスト比を満たすことを確かめる。
const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

type Theme = "light" | "dark";

/** `--hr-x: light-dark(#ライト, #ダーク);` の形で書かれた、不透明な色のトークン。 */
const token = (name: string, theme: Theme): string => {
	const pair = css.match(
		new RegExp(`--hr-${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\);`),
	);
	if (!pair) {
		throw new Error(`--hr-${name} が light-dark(#rrggbb, #rrggbb) の形で見つからない`);
	}
	return pair[theme === "light" ? 1 : 2];
};

const luminance = (hex: string): number => {
	const [r, g, b] = [1, 3, 5].map((at) => {
		const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
};

const grounds = ["bg", "bg-elevated", "surface", "surface-hover"];
const fills = ["accent", "accent-hover", "success", "warning", "danger"];

it.each<Theme>(["light", "dark"])("%s テーマの配色がコントラスト比を満たす", (theme) => {
	const ratio = (fg: string, bg: string) => contrast(token(fg, theme), token(bg, theme));

	for (const ground of grounds) {
		// 文字は 4.5:1 以上
		for (const text of [
			"text",
			"text-muted",
			"link",
			"success-text",
			"warning-text",
			"danger-text",
		]) {
			expect(ratio(text, ground), `${text} / ${ground}`).toBeGreaterThanOrEqual(4.5);
		}
		// 押せる部品の枠と塗り、フォーカスの輪は 3:1 以上
		for (const part of ["border-input", ...fills]) {
			expect(ratio(part, ground), `${part} / ${ground}`).toBeGreaterThanOrEqual(3);
		}
	}
	// 塗りの上に載せる文字
	for (const fill of fills) {
		expect(ratio("on-accent", fill), `on-accent / ${fill}`).toBeGreaterThanOrEqual(4.5);
	}
});
