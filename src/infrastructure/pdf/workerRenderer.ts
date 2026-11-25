import type { PdfKind, RenderPdf } from "./WasmPdfRenderer";

export interface PdfRequest {
	id: number;
	kind: PdfKind;
	data: unknown;
}
export type PdfReply = { id: number; pdf: Uint8Array<ArrayBuffer> } | { id: number; error: Error };

/** 同じ Worker で WASM を再利用し、並行する出力にも対応する。 */
export function createWorkerRenderer(start: () => Worker): RenderPdf {
	let worker: Worker | undefined;
	let nextId = 0;
	const pending = new Map<
		number,
		{
			resolve: (pdf: Uint8Array<ArrayBuffer>) => void;
			reject: (error: Error) => void;
		}
	>();
	const connect = () => {
		const current = start();
		current.onmessage = ({ data }: MessageEvent<PdfReply>) => {
			const request = pending.get(data.id);
			pending.delete(data.id);
			if ("error" in data) {
				request?.reject(data.error);
			} else {
				request?.resolve(data.pdf);
			}
		};
		const fail = (error: Error) => {
			current.terminate();
			worker = undefined;
			for (const request of pending.values()) {
				request.reject(error);
			}
			pending.clear();
		};
		current.onerror = (event) => fail(new Error(event.message || "PDF の出力処理が停止しました"));
		current.onmessageerror = () => fail(new Error("PDF の出力結果を読み取れませんでした"));
		return current;
	};
	return (kind, data) =>
		new Promise((resolve, reject) => {
			worker ??= connect();
			const id = ++nextId;
			worker.postMessage({ id, kind, data } satisfies PdfRequest);
			pending.set(id, { resolve, reject });
		});
}

export const renderPdf = createWorkerRenderer(
	() => new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" }),
);
