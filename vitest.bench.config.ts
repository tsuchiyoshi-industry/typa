import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// ブラウザの計測と同じ本番版を使い、イベントによる DOM 更新も計測に含める。
	plugins: [solid({ refresh: false, dev: false })],
	resolve: { conditions: ["production", "browser"] },
	ssr: { resolve: { conditions: ["production", "browser"] } },
	test: {
		name: "performance",
		pool: "forks",
		maxWorkers: 1,
		setupFiles: ["src/test/setupSolidEvents.ts"],
		// 外部化された signals は Node の development 条件を拾うので、Vite 側で解決する。
		server: { deps: { inline: [/solid-js/, /@solidjs[/\\]/] } },
		testTimeout: 120_000,
		benchmark: {
			include: ["src/**/*.bench.{ts,tsx}"],
			exclude: ["src/**/*.browser.bench.tsx"],
		},
		reporters: ["default", "json"],
		outputFile: { json: ".vitest/bench/results.json" },
	},
});
