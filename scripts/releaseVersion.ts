import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertReleaseVersion(expected: string, versions: Record<string, string>): void {
	if (
		!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(
			expected,
		)
	) {
		throw new Error("Invalid release version.");
	}
	for (const [file, version] of Object.entries(versions)) {
		if (version !== expected) {
			throw new Error(`${file}: expected ${expected}, found ${version || "missing"}`);
		}
	}
}

export function readReleaseVersions(root: string): Record<string, string> {
	const read = (path: string) => readFileSync(resolve(root, path), "utf8");
	return {
		"package.json": JSON.parse(read("package.json")).version,
		"tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
		"Cargo.toml":
			read("src-tauri/Cargo.toml").match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1] ?? "",
		"Cargo.lock":
			read("src-tauri/Cargo.lock").match(
				/\[\[package\]\]\r?\nname = "typa"\r?\nversion = "([^"]+)"/,
			)?.[1] ?? "",
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	assertReleaseVersion(process.argv[2] ?? "", readReleaseVersions(process.cwd()));
	process.stdout.write("Release versions match.\n");
}
