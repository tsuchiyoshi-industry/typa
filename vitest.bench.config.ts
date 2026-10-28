import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [solid({ hot: false })],
	resolve: { conditions: ["development", "browser"] },
	test: {
		name: "performance",
		environment: "node",
		pool: "forks",
		maxWorkers: 1,
		testTimeout: 120_000,
		benchmark: { include: ["src/**/*.bench.{ts,tsx}"] },
		reporters: ["default", "json"],
		outputFile: { json: ".vitest/bench/results.json" },
	},
});
