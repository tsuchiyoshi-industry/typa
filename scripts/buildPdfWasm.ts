// ブラウザ版の PDF(src-tauri/pdf を WASM にしたもの)を作り、gzip にして public/ に置く。
// vite build がそのまま dist/ に入れる。デスクトップ版はネイティブの PDF を使うので要らない。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const built = new URL("src-tauri/target/wasm32-unknown-unknown/wasm/typa_pdf.wasm", root);
const output = new URL("public/typa-pdf.wasm.gz", root);
// Cloudflare Pages の1ファイルの上限
const LIMIT = 25 * 1024 * 1024;

const cargo = spawnSync(
	"cargo",
	[
		"build",
		"--manifest-path",
		"src-tauri/Cargo.toml",
		"--locked",
		"-p",
		"typa-pdf",
		"--target",
		"wasm32-unknown-unknown",
		"--profile",
		"wasm",
	],
	{ cwd: root, stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" },
);
if (cargo.status !== 0) {
	throw new Error(
		`cargo build of typa-pdf for wasm32 failed (rustup target add wasm32-unknown-unknown?)\n${cargo.stderr ?? cargo.error}`,
	);
}

const wasm = readFileSync(built);
// ブラウザは何も渡さずに読み込む。依存が JS の関数(時計など)を求めるようになったら、ここで止める
const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
if (imports.length > 0) {
	throw new Error(
		`typa-pdf.wasm must not import anything, but imports:\n${imports.map((i) => `${i.module}.${i.name}`).join("\n")}`,
	);
}
const gzipped = gzipSync(wasm, { level: 9 });
if (gzipped.length > LIMIT) {
	throw new Error(`typa-pdf.wasm.gz is ${gzipped.length} bytes, over the ${LIMIT}-byte limit`);
}
writeFileSync(output, gzipped);
console.log(`typa-pdf.wasm.gz: ${wasm.length} → ${gzipped.length} bytes`);
