import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./e2e/support";

// Tests share one database and walk one sheet through its stages, so they run in order.
export default defineConfig({
	testDir: "e2e",
	globalSetup: "./e2e/globalSetup.ts",
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: `http://localhost:${E2E_PORT}`,
		locale: "ja-JP",
		timezoneId: "Asia/Tokyo",
		trace: "retain-on-failure",
	},
	// The desktop app renders with WebView2 (Chromium).
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
