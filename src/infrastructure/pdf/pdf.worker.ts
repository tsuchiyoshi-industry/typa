import { createPdfRenderer, loadPdfWasm } from "./WasmPdfRenderer";
import type { PdfReply, PdfRequest } from "./workerRenderer";

const render = createPdfRenderer(loadPdfWasm);

self.onmessage = async ({ data }: MessageEvent<PdfRequest>) => {
	const { id, kind } = data;
	try {
		const pdf = await render(kind, data.data);
		self.postMessage({ id, pdf } satisfies PdfReply, { transfer: [pdf.buffer] });
	} catch (error) {
		self.postMessage({
			id,
			error: error instanceof Error ? error : new Error(String(error)),
		} satisfies PdfReply);
	}
};
