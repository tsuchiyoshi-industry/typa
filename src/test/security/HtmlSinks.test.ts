import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// 保存された目標・コメントは他の評価者や Admin の画面にも出る(Stored XSS)。画面のコードは文字列を
// テキストとして描き、HTML として解釈させる口を持たない。StoredContent.browser.test.tsx の前提を全画面で保つ。
const root = new URL("../../", import.meta.url);
const sinks =
	/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(|createContextualFragment/;

it("keeps raw HTML and code evaluation out of the application code", () => {
	const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
		(file) => /\.tsx?$/.test(file) && !/(^|[\\/])test[\\/]|\.test\.tsx?$/.test(file),
	);
	expect(files.length).toBeGreaterThan(50);
	const found = files.filter((file) => sinks.test(readFileSync(new URL(file, root), "utf8")));
	expect(found).toEqual([]);
});
