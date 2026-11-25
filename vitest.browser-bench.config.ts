import solid from "@solidjs/vite-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const benchFiles = ["src/**/*.browser.bench.tsx"];

export default defineConfig({
	// 配布物と同じ本番版の Solid で測る(開発版は診断と記録のぶん遅い)。テストではプラグインが開発版を選ぶので、条件で指定する
	plugins: [solid({ refresh: false, dev: false })],
	resolve: { conditions: ["production", "browser"] },
	optimizeDeps: {
		// Scan only browser benchmarks, never Node tests or Edge Function transports.
		entries: benchFiles,
		// Keep the initial runtime bundle stable before the first test is imported.
		include: ["@solidjs/testing-library", "solid-js", "@solidjs/web"],
	},
	test: {
		name: "chromium-performance",
		// 実行は下の Chromium。environment を "node" と書くと Solid のプラグインがサーバー向けに変換するので書かない
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
