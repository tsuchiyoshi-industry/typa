import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPublicBuildEnvironment } from "../../scripts/releaseEnvironment";
import capability from "../../src-tauri/capabilities/default.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("release security configuration", () => {
	it("keeps renderer privileges minimal and CSP enabled", () => {
		expect(capability.permissions).toEqual([
			"core:default",
			"core:window:allow-destroy",
			"dialog:allow-save",
			// 保存したPDFをエクスプローラーで示すだけ。URL やファイルを開く権限は渡さない
			"opener:allow-reveal-item-in-dir",
		]);
		// 共有PCで、前の人の入力が WebView2 の入力候補に出ないようにする
		expect(tauriConfig.app.windows[0].generalAutofillEnabled).toBe(false);
		expect(tauriConfig.app.security.csp).toContain("object-src 'none'");
		expect(tauriConfig.app.security.csp).not.toContain("'unsafe-eval'");
		expect(tauriConfig.app.security.csp).not.toContain("script-src 'self' 'unsafe-inline'");
		expect(tauriConfig.plugins.updater.endpoints.every((url) => url.startsWith("https://"))).toBe(
			true,
		);
	});
	it.each([
		"VITE_SERVICE_ROLE",
		"VITE_SUPABASE_SERVICE_ROLE_KEY",
		"VITE_SIGNING_PRIVATE_KEY",
		"VITE_CLIENT_SECRET",
		"VITE_ACCESS_TOKEN",
		// SMTP の設定は DB(workspace_settings)にあり、アプリには埋め込まない
		"VITE_SMTP_PASSWORD",
	])("rejects public secret %s without printing its value", (name) => {
		expect(() => assertPublicBuildEnvironment({ [name]: "synthetic-secret" }, "")).toThrow(name);
		try {
			assertPublicBuildEnvironment({ [name]: "synthetic-secret" }, "");
		} catch (error) {
			expect(String(error)).not.toContain("synthetic-secret");
		}
	});
	it("rejects Supabase service keys", () => {
		expect(() =>
			assertPublicBuildEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" }, ""),
		).toThrow("secret key");
		const serviceKey = `eyJ.${btoa(JSON.stringify({ role: "service_role" }))}.test`;
		expect(() =>
			assertPublicBuildEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: serviceKey }, ""),
		).toThrow("anon");
	});
	it("accepts public keys and HTTPS endpoints covered by CSP", () => {
		const url = "https://test.supabase.co";
		expect(() =>
			assertPublicBuildEnvironment(
				{ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", VITE_SUPABASE_URL: url },
				`connect-src ipc: ${url}`,
			),
		).not.toThrow();
		expect(() =>
			assertPublicBuildEnvironment(
				{ VITE_SUPABASE_URL: "http://test.supabase.co" },
				"connect-src http://test.supabase.co",
			),
		).toThrow("HTTPS");
		expect(() =>
			assertPublicBuildEnvironment(
				{ VITE_SUPABASE_URL: url },
				"connect-src https://other.supabase.co",
			),
		).toThrow("CSP");
	});
	it("rejects missing build configuration and unreviewed public variables", () => {
		expect(() => assertPublicBuildEnvironment({}, "")).toThrow("required");
		expect(() =>
			assertPublicBuildEnvironment(
				{ VITE_SUPABASE_URL: "https://test.supabase.co" },
				"connect-src https://test.supabase.co",
			),
		).toThrow("key is required");
		expect(() => assertPublicBuildEnvironment({ VITE_EXTRA_KEY: "private" }, "")).toThrow(
			"VITE_EXTRA_KEY",
		);
	});

	it("requires every shared check to pass before release packaging", () => {
		const release = readFileSync(
			new URL("../../.github/workflows/release.yml", import.meta.url),
			"utf8",
		);
		const checks = readFileSync(
			new URL("../../.github/workflows/test.yml", import.meta.url),
			"utf8",
		);
		expect(release).toMatch(/checks:\s+needs: metadata\s+uses: \.\/\.github\/workflows\/test.yml/);
		const build = release.split(/^ {2}build-and-release:\r?$/m)[1];
		expect(build).toContain("needs: [metadata, checks]");
		expect(build).not.toMatch(/^ {4}(?:if|continue-on-error):/m);
		expect(build).toContain("bun run tauri build");
		expect(checks).toMatch(/on:\s+workflow_call:/);
		// The aggregate must fail even when a prerequisite fails or is skipped;
		// an automatically skipped status alone would not block branch protection.
		const gate = checks.split(/^ {2}test:\r?$/m)[1];
		expect(gate).toMatch(/if: \$\{\{ always\(\) \}\}/);
		expect(gate).toContain("needs: [frontend, notification, rust, database]");
		for (const job of ["frontend", "notification", "rust", "database"]) {
			expect(gate).toContain(`test '\${{ needs.${job}.result }}' = success`);
		}
		for (const command of [
			"bun run typecheck",
			"bun run test:coverage",
			"cargo test --manifest-path src-tauri/Cargo.toml --locked --release",
			"cargo audit --file src-tauri/Cargo.lock",
			"deno test",
		]) {
			expect(checks).toContain(command);
			expect(release).not.toContain(command);
		}
	});
});
