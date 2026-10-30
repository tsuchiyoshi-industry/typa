/**
 * ブラウザ版の PDF。デスクトップ版と同じ Rust の typa-pdf(src-tauri/pdf)を WASM にしたものを使う。
 * 受け渡しは src-tauri/pdf/src/wasm.rs を参照。
 */

export interface PdfWasmExports {
	memory: WebAssembly.Memory;
	alloc(len: number): number;
	dealloc(ptr: number, len: number): void;
	render(kind: number, ptr: number, len: number): number;
}

export type PdfKind = "sheet" | "overview";
export type RenderPdf = (kind: PdfKind, data: unknown) => Promise<Uint8Array<ArrayBuffer>>;

const KIND: Record<PdfKind, number> = { sheet: 0, overview: 1 };

// 33 MB あり Cloudflare Pages の1ファイルの上限(25 MiB)を超えるので、gzip で置いて読み込んでから展開する
const WASM_URL = "/typa-pdf.wasm.gz";
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

export async function loadPdfWasm(fetcher: typeof fetch = fetch): Promise<PdfWasmExports> {
	const response = await fetcher(WASM_URL);
	if (!response.ok) {
		throw new Error(`PDFの部品を読み込めませんでした(${response.status})`);
	}
	let bytes = new Uint8Array(await response.arrayBuffer());
	// サーバーによっては .gz に Content-Encoding: gzip を付け、ブラウザが先に展開する(Vite の開発サーバーなど)。
	// 先頭が WASM の印(\0asm)でなければ、まだ gzip のままなので展開する
	if (!WASM_MAGIC.every((byte, i) => bytes[i] === byte)) {
		const unpacked = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
		bytes = new Uint8Array(await new Response(unpacked).arrayBuffer());
	}
	const { instance } = await WebAssembly.instantiate(bytes, {});
	return instance.exports as unknown as PdfWasmExports;
}

/** 最初の出力で WASM を読み込み、以後は使い回す。読み込みに失敗したり中で止まったりしたら、次は読み直す。 */
export function createPdfRenderer(load: () => Promise<PdfWasmExports>): RenderPdf {
	let loading: Promise<PdfWasmExports> | null = null;
	return async (kind, data) => {
		loading ??= load();
		let wasm: PdfWasmExports;
		try {
			wasm = await loading;
		} catch (error) {
			loading = null;
			throw error;
		}
		const json = new TextEncoder().encode(JSON.stringify(data));
		const input = wasm.alloc(json.length);
		new Uint8Array(wasm.memory.buffer, input, json.length).set(json);
		let output: number;
		try {
			// ponytail: 画面のスレッドで組版する(1件0.3秒ほど)。重くなったら Web Worker に移す
			output = wasm.render(KIND[kind], input, json.length);
		} catch (error) {
			// 中で止まった WASM はメモリの状態が分からないので捨てる
			loading = null;
			throw new Error(`PDFを作れませんでした: ${error instanceof Error ? error.message : error}`);
		}
		// 組版中にメモリが増えると前の buffer は使えなくなるので、読み直してから見る
		const header = new DataView(wasm.memory.buffer, output, 5);
		const failed = header.getUint8(0) !== 0;
		const length = header.getUint32(1, true);
		const body = new Uint8Array(wasm.memory.buffer, output + 5, length).slice();
		wasm.dealloc(output, 5 + length);
		if (failed) {
			throw new Error(new TextDecoder().decode(body));
		}
		return body;
	};
}

export const renderPdf: RenderPdf = createPdfRenderer(() => loadPdfWasm());
