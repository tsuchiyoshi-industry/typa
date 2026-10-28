import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const benchFiles = ["src/**/*.browser.bench.tsx"];

export default defineConfig({
	plugins: [solid({ hot: false, dev: false })],
	resolve: { conditions: ["production", "browser"] },
	optimizeDeps: {
		// Scan only browser benchmarks, never Node tests or Edge Function transports.
		entries: benchFiles,
		// Keep the initial runtime bundle stable before the first test is imported.
		include: ["@solidjs/testing-library", "solid-js", "solid-js/web"],
	},
	test: {
		name: "chromium-performance",
		include: benchFiles,
		testTimeout: 120_000,
		fileParallelism: false,
		benchmark: { include: benchFiles },
		reporters: ["default", "json"],
		outputFile: { json: ".vitest/bench/browser/results.json" },
		api: { allowWrite: true, allowExec: true },
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({ contextOptions: { locale: "ja-JP", colorScheme: "light" } }),
			instances: [{ browser: "chromium" }],
			viewport: { width: 1440, height: 900 },
			screenshotDirectory: ".vitest/bench/browser/screenshots",
		},
	},
});
