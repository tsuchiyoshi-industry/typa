import { expect, it, vi } from "vitest";
import { createWorkerRenderer, type PdfReply, type PdfRequest } from "./workerRenderer";

function fakeWorker() {
	return {
		postMessage: vi.fn<(request: PdfRequest) => void>(),
		terminate: vi.fn(),
		onmessage: (_event: { data: PdfReply }) => {},
		onerror: (_event: { message: string }) => {},
	};
}

it("routes simultaneous exports and recovers from a failed worker", async () => {
	const first = fakeWorker();
	const next = fakeWorker();
	const start = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
	const render = createWorkerRenderer(start);
	const sheet = render("sheet", {});
	const overview = render("overview", {});
	const [{ id: sheetId }, { id: overviewId }] = first.postMessage.mock.calls.map(
		([request]) => request,
	);
	const pdf = new Uint8Array([37, 80, 68, 70]);
	first.onmessage({ data: { id: overviewId, pdf } });
	await expect(overview).resolves.toEqual(pdf);
	first.onmessage({ data: { id: sheetId, error: new Error("invalid sheet") } });
	await expect(sheet).rejects.toThrow("invalid sheet");

	const outstanding = Promise.allSettled([render("sheet", {}), render("overview", {})]);
	first.onerror({ message: "worker failed" });
	expect(await outstanding).toEqual(
		Array(2).fill({ status: "rejected", reason: new Error("worker failed") }),
	);
	expect(first.terminate).toHaveBeenCalledOnce();
	const retry = render("sheet", {});
	next.onmessage({ data: { id: next.postMessage.mock.calls[0][0].id, pdf } });
	await expect(retry).resolves.toEqual(pdf);
	expect(start).toHaveBeenCalledTimes(2);
});
