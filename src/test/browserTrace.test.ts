import { expect, it } from "vitest";
import { summarizeTrace, type TraceEvent } from "./browserTrace";

const event = (name: string, ts: number, dur?: number, tid = 1): TraceEvent => ({
	name,
	ts,
	dur,
	pid: 1,
	tid,
	ph: dur === undefined ? "I" : "X",
});
const markers = [event("typa:test:start", 1_000), event("typa:test:end", 11_000)];

it("clips to the operation and excludes other renderer threads", () => {
	const result = summarizeTrace(
		[
			...markers,
			event("FunctionCall", 0, 3_000),
			event("FunctionCall", 9_000, 5_000),
			event("FunctionCall", 1_000, 10_000, 2),
		],
		"test",
	);
	expect(result).toEqual({
		id: "test",
		elapsedMs: 10,
		scriptMs: 4,
		gcMs: 0,
		styleLayoutMs: 0,
		paintMs: 0,
		otherAndFrameWaitMs: 6,
	});
});

it("does not double count nested script, style, layout or paint", () => {
	const result = summarizeTrace(
		[
			...markers,
			event("EventDispatch", 1_000, 8_000),
			event("FunctionCall", 2_000, 6_000),
			event("UpdateLayoutTree", 3_000, 1_000),
			event("Layout", 3_500, 1_500),
			event("PrePaint", 7_000, 1_000),
			event("Paint", 7_500, 500),
		],
		"test",
	);
	expect(result).toEqual({
		id: "test",
		elapsedMs: 10,
		scriptMs: 5,
		gcMs: 0,
		styleLayoutMs: 2,
		paintMs: 1,
		otherAndFrameWaitMs: 2,
	});
});

it("counts V8 callback work and separates nested GC", () => {
	const result = summarizeTrace(
		[
			...markers,
			event("v8.callFunction", 1_000, 8_000),
			event("MinorGC", 2_000, 1_000),
			event("V8.GCScavenger", 2_100, 800),
		],
		"test",
	);
	expect(result.scriptMs).toBe(7);
	expect(result.gcMs).toBe(1);
	expect(result.otherAndFrameWaitMs).toBe(2);
});

it("requires both operation markers", () => {
	expect(() => summarizeTrace([], "test")).toThrow("trace markers");
});
