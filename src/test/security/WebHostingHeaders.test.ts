import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import tauri from "../../../src-tauri/tauri.conf.json";

// Web 版(Cloudflare Pages)が返すヘッダーの設定の回帰検査。実際の配信の検証ではない。
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** _headers を「パス → ヘッダー名(小文字) → 値」にする。 */
function parseHeaders(text: string) {
	const rules = new Map<string, Map<string, string>>();
	let current: Map<string, string> | undefined;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith("#")) {
			continue;
		}
		if (!/^\s/.test(line)) {
			current = new Map();
			rules.set(line.trim(), current);
			continue;
		}
		const [name, ...value] = line.trim().split(":");
		current?.set(name.trim().toLowerCase(), value.join(":").trim());
	}
	return rules;
}

const rules = parseHeaders(read("public/_headers"));
const everyPage = rules.get("/*") ?? new Map<string, string>();
const csp = new Map(
	(everyPage.get("content-security-policy") ?? "").split(";").map((part) => {
		const [name, ...sources] = part.trim().split(/\s+/);
		return [name, sources] as const;
	}),
);

it("restricts active content like the desktop app, and allows only the PDF WebAssembly", () => {
	expect(csp.get("default-src")).toEqual(["'self'"]);
	// PDF は同じオリジンの WASM で作る。eval は許さない
	expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
	for (const directive of [
		"object-src",
		"base-uri",
		"frame-src",
		"form-action",
		"frame-ancestors",
	]) {
		expect(csp.get(directive), directive).toEqual(["'none'"]);
	}
});

it("connects only to itself and the same Supabase project as the desktop app", () => {
	const desktop = tauri.app.security.csp
		.split(";")
		.find((part) => part.trim().startsWith("connect-src "))
		?.trim()
		.split(/\s+/)
		.slice(1)
		.filter((source) => /^(?:https|wss):\/\//.test(source));
	expect(desktop?.length).toBeGreaterThan(0);
	expect(csp.get("connect-src")).toEqual(["'self'", ...(desktop ?? [])]);
});

it("forbids framing, sniffing and leaking the URL to other sites", () => {
	expect(everyPage.get("x-frame-options")).toBe("DENY");
	expect(everyPage.get("x-content-type-options")).toBe("nosniff");
	expect(everyPage.get("referrer-policy")).toBe("no-referrer");
});

it("checks for a new PDF module on every load, since its name does not change between releases", () => {
	expect(rules.get("/typa-pdf.wasm.gz")?.get("cache-control")).toBe("no-cache");
});

it("keeps index.html free of inline scripts, which the policy would block", () => {
	const scripts = read("index.html").match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
	expect(scripts.length).toBeGreaterThan(0);
	for (const script of scripts) {
		expect(script, script).toMatch(/^<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>$/);
	}
});
