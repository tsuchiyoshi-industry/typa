import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [solid({ hot: false, dev: false })],
	resolve: { conditions: ["production", "browser"] },
	test: {
		name: "chromium-performance",
		testTimeout: 120_000,
		fileParallelism: false,
		benchmark: { include: ["src/**/*.browser.bench.tsx"] },
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
