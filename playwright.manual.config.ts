import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// docs/manual/*.md の画面写真を撮り直し、PDF にする。E2E と同じ隔離 DB を使う。
export default defineConfig({
	...base,
	testMatch: "manual.shots.ts",
	reporter: "list",
	use: {
		...base.use,
		viewport: { width: 1280, height: 800 },
		colorScheme: "light",
	},
	projects: undefined,
});
