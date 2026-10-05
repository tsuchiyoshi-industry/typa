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
		]);
		expect(tauriConfig.app.security.csp).toContain("object-src 'none'");
		expect(tauriConfig.app.security.csp).not.toContain("'unsafe-eval'");
		expect(tauriConfig.app.security.csp).not.toContain("script-src 'self' 'unsafe-inline'");
		expect(tauriConfig.plugins.updater.endpoints.every((url) => url.startsWith("https://"))).toBe(
			true,
		);
	});
	it.each([
		"VITE_SERVICE_ROLE",
		"VITE_SIGNING_PRIVATE_KEY",
		"VITE_CLIENT_SECRET",
		"VITE_ACCESS_TOKEN",
	])("rejects public secret %s without printing its value", (name) => {
		expect(() => assertPublicBuildEnvironment({ [name]: "synthetic-secret" }, "")).toThrow(name);
		try {
			assertPublicBuildEnvironment({ [name]: "synthetic-secret" }, "");
		} catch (error) {
			expect(String(error)).not.toContain("synthetic-secret");
		}
	});
	it("allows the risk-accepted notification SMTP password", () => {
		expect(() =>
			assertPublicBuildEnvironment({ VITE_SMTP_PASSWORD: "synthetic-password" }, ""),
		).not.toThrow();
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
	it("keeps tests and type checks ahead of release packaging", () => {
		const workflow = readFileSync(
			new URL("../../.github/workflows/release.yml", import.meta.url),
			"utf8",
		);
		for (const command of ["bun run typecheck", "bun run test:coverage", "bun run test:rust"]) {
			expect(workflow.indexOf(command)).toBeGreaterThan(-1);
			expect(workflow.indexOf(command)).toBeLessThan(workflow.indexOf("bun run tauri build"));
		}
	});
});
