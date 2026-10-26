import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// 画面のテストは既定で happy-dom。<dialog> やフォーカス移動など本物のブラウザでないと
// 確かめられないものは *.browser.test.tsx に分け、Chromium で動かす。
export default defineConfig({
	plugins: [solid({ hot: false })],
	resolve: { conditions: ["development", "browser"] },
	test: {
		// PGlite の WASM と happy-dom を、ファイルごとにプロセスごと破棄する。
		// threads は Windows/Node で初期化・終了が滞り、次の worker の起動までタイムアウトした。
		pool: "forks",
		maxWorkers: 2,
		clearMocks: true,
		restoreMocks: true,
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					environment: "node",
					include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
					exclude: ["src/**/*.browser.test.tsx"],
				},
			},
			{
				extends: true,
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.tsx"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
		coverage: {
			provider: "v8",
			include: ["src/domain/**/*.ts", "src/application/**/*.ts"],
			exclude: ["**/*.test.ts", "**/repositories/**", "**/ports/**", "**/*Dto.ts"],
			reporter: ["text", "html", "json-summary"],
			thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
		},
	},
});
