import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import tauri from "../../../src-tauri/tauri.conf.json";

// 設定の回帰検査であり、配布バイナリやWebホスティングのヘッダーの検証ではない。
it.each(["csp", "devCsp"] as const)(
	"restricts active content and network destinations in %s",
	(key) => {
		const directives = new Map(
			tauri.app.security[key].split(";").map((part) => {
				const [name, ...sources] = part.trim().split(/\s+/);
				return [name, sources] as const;
			}),
		);
		expect(directives.get("default-src")).toEqual(["'self'"]);
		expect(directives.get("script-src")).toEqual(["'self'"]);
		for (const directive of ["object-src", "base-uri", "frame-src", "form-action"]) {
			expect(directives.get(directive), directive).toEqual(["'none'"]);
		}
		const connect = directives.get("connect-src");
		expect(connect?.length).toBeGreaterThan(0);
		for (const source of connect ?? []) {
			expect(source).toMatch(
				/^(?:ipc:|http:\/\/ipc\.localhost|(?:https|wss):\/\/[a-z0-9]+\.supabase\.co|ws:\/\/localhost:142[01])$/,
			);
			if (key === "csp") {
				expect(source).not.toMatch(/^ws:\/\//);
			}
		}
	},
);

it("does not grant remote pages or additional windows native capabilities", () => {
	const directory = new URL("../../../src-tauri/capabilities/", import.meta.url);
	const files = readdirSync(directory).filter((name) => name.endsWith(".json"));
	expect(files.length).toBeGreaterThan(0);
	const allowed = new Set([
		"core:default",
		"core:window:allow-destroy",
		"dialog:allow-save",
		"opener:allow-reveal-item-in-dir",
		"process:default",
		"updater:default",
	]);
	for (const file of files) {
		const capability = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
		expect(capability.windows, file).toEqual(["main"]);
		expect(capability.remote, file).toBeUndefined();
		for (const permission of capability.permissions) {
			expect(typeof permission, file).toBe("string");
			expect(allowed.has(permission), `${file}: ${permission}`).toBe(true);
		}
	}
});

it("requires a public update verification key and HTTPS metadata", () => {
	expect(tauri.bundle.createUpdaterArtifacts).toBe(true);
	expect(tauri.plugins.updater.pubkey.length).toBeGreaterThan(0);
	expect(tauri.plugins.updater.endpoints.length).toBeGreaterThan(0);
	for (const endpoint of tauri.plugins.updater.endpoints) {
		const url = new URL(endpoint);
		expect(url.protocol).toBe("https:");
		expect(url.username + url.password).toBe("");
	}
});
