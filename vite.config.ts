import { defineConfig, loadEnv, type ResolvedConfig } from "vite";
import solid from "vite-plugin-solid";
import { assertPublicBuildEnvironment } from "./scripts/releaseEnvironment.ts";
import tauriConfig from "./src-tauri/tauri.conf.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => ({
	plugins: [
		solid(),
		{
			name: "public-build-environment",
			apply: "build",
			configResolved(config: ResolvedConfig) {
				assertPublicBuildEnvironment(
					loadEnv(mode, config.root, "VITE_"),
					tauriConfig.app.security.csp,
				);
			},
		},
	],

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}));
