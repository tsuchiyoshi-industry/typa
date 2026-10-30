import { describe, expect, it, vi } from "vitest";
import { createPdfRenderer, loadPdfWasm, type PdfWasmExports } from "./WasmPdfRenderer";

/** typa-pdf の WASM と同じ受け渡し(入力を alloc に書き、[状態][長さ][本体] を返す)をする偽物。 */
function fakeWasm(reply: (kind: number, json: string) => { status: number; body: Uint8Array }) {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let next = 8;
	const freed: [number, number][] = [];
	const exports: PdfWasmExports = {
		memory,
		alloc: (len) => {
			const ptr = next;
			next += len;
			return ptr;
		},
		dealloc: (ptr, len) => {
			freed.push([ptr, len]);
		},
		render: (kind, ptr, len) => {
			const json = new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
			const { status, body } = reply(kind, json);
			const out = next;
			next += 5 + body.length;
			const view = new DataView(memory.buffer, out, 5);
			view.setUint8(0, status);
			view.setUint32(1, body.length, true);
			new Uint8Array(memory.buffer, out + 5, body.length).set(body);
			return out;
		},
	};
	return { exports, freed };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("createPdfRenderer", () => {
	it("passes the data as JSON and returns the PDF, freeing the result", async () => {
		const seen: [number, string][] = [];
		const wasm = fakeWasm((kind, json) => {
			seen.push([kind, json]);
			return { status: 0, body: bytes("%PDF-1.7") };
		});
		const render = createPdfRenderer(async () => wasm.exports);
		const pdf = await render("overview", { periodName: "26期" });
		expect(new TextDecoder().decode(pdf)).toBe("%PDF-1.7");
		expect(seen).toEqual([[1, '{"periodName":"26期"}']]);
		expect(wasm.freed).toEqual([[expect.any(Number), 5 + 8]]);
		await render("sheet", {});
		expect(seen[1][0]).toBe(0);
	});

	it("turns a failure from Typst into an error with its message", async () => {
		const wasm = fakeWasm(() => ({ status: 1, body: bytes("PDFのデータが正しくありません") }));
		const render = createPdfRenderer(async () => wasm.exports);
		await expect(render("sheet", {})).rejects.toThrow("PDFのデータが正しくありません");
		expect(wasm.freed).toHaveLength(1);
	});

	it("loads the module once, and loads it again after a crash or a failed download", async () => {
		const healthy = fakeWasm(() => ({ status: 0, body: bytes("%PDF") }));
		const crashing = fakeWasm(() => ({ status: 0, body: bytes("") }));
		crashing.exports.render = () => {
			throw new WebAssembly.RuntimeError("unreachable");
		};
		const load = vi
			.fn<() => Promise<PdfWasmExports>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(crashing.exports)
			.mockResolvedValue(healthy.exports);
		const render = createPdfRenderer(load);

		await expect(render("sheet", {})).rejects.toThrow("offline");
		// 中で止まった WASM は状態が壊れているかもしれないので、使い回さない
		await expect(render("sheet", {})).rejects.toThrow("PDFを作れませんでした");
		await expect(render("sheet", {})).resolves.toHaveLength(4);
		await expect(render("sheet", {})).resolves.toHaveLength(4);
		expect(load).toHaveBeenCalledTimes(3);
	});
});

describe("loadPdfWasm", () => {
	// 中身が空の WASM モジュール(マジックナンバーとバージョンだけ)
	const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
	const gzip = async (data: Uint8Array<ArrayBuffer>) =>
		new Uint8Array(
			await new Response(
				new Blob([data]).stream().pipeThrough(new CompressionStream("gzip")),
			).arrayBuffer(),
		);

	it("unpacks the gzipped module after downloading it", async () => {
		const body = await gzip(emptyModule);
		const fetcher = vi.fn(async () => new Response(body, { status: 200 }));
		const exports = await loadPdfWasm(fetcher);
		expect(fetcher).toHaveBeenCalledWith("/typa-pdf.wasm.gz");
		expect(Object.keys(exports)).toEqual([]);
	});

	it("also accepts the module when the server already unpacked it (Content-Encoding: gzip)", async () => {
		const fetcher = async () => new Response(emptyModule, { status: 200 });
		await expect(loadPdfWasm(fetcher)).resolves.toBeDefined();
	});

	it("says the PDF part could not be downloaded, with the status", async () => {
		const fetcher = async () => new Response("not found", { status: 404 });
		await expect(loadPdfWasm(fetcher)).rejects.toThrow("PDFの部品を読み込めませんでした(404)");
	});
});
