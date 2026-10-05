import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			include: ["src/domain/**/*.ts", "src/application/**/*.ts"],
			exclude: ["**/*.test.ts", "**/repositories/**", "**/ports/**", "**/*Dto.ts"],
			reporter: ["text", "html", "json-summary"],
			thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
		},
	},
});
