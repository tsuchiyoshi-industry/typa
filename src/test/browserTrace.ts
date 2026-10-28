export interface TraceEvent {
	name: string;
	ph: string;
	ts: number;
	dur?: number;
	pid: number;
	tid: number;
	cat?: string;
}

type Interval = [number, number];

function covered(intervals: Interval[]): number {
	let total = 0;
	let end = -Infinity;
	for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
		total += Math.max(0, to - Math.max(end, from));
		end = Math.max(end, to);
	}
	return total;
}

const scriptNames = new Set([
	"FunctionCall",
	"EvaluateScript",
	"RunMicrotasks",
	"EventDispatch",
	"V8.Execute",
	"v8.callFunction",
]);
const layoutNames = new Set(["Layout", "UpdateLayoutTree", "RecalculateStyles", "RecalcStyle"]);
const paintNames = new Set(["PrePaint", "Paint", "Layerize", "CompositeLayers", "UpdateLayerTree"]);

/** Main renderer thread only; union nested intervals before adding durations. */
export function summarizeTrace(events: TraceEvent[], id: string) {
	const start = events.find((event) => event.name === `typa:${id}:start`);
	const end = events.find((event) => event.name === `typa:${id}:end`);
	if (!start || !end || end.ts <= start.ts) {
		throw new Error(`Missing or invalid trace markers for ${id}`);
	}
	const script: Interval[] = [];
	const layout: Interval[] = [];
	const paint: Interval[] = [];
	const gc: Interval[] = [];
	for (const event of events) {
		if (event.ph !== "X" || event.pid !== start.pid || event.tid !== start.tid || !event.dur) {
			continue;
		}
		const from = Math.max(start.ts, event.ts);
		const to = Math.min(end.ts, event.ts + event.dur);
		if (to <= from) {
			continue;
		}
		const destination =
			event.name === "MinorGC" || event.name === "MajorGC" || event.name.startsWith("V8.GC")
				? gc
				: scriptNames.has(event.name)
					? script
					: layoutNames.has(event.name)
						? layout
						: paintNames.has(event.name)
							? paint
							: undefined;
		destination?.push([from, to]);
	}
	const layoutAndGc = covered([...layout, ...gc]);
	const renderingAndGc = covered([...layout, ...paint, ...gc]);
	const busy = covered([...script, ...layout, ...paint, ...gc]);
	const ms = (value: number) => Math.round(value) / 1000;
	return {
		id,
		elapsedMs: ms(end.ts - start.ts),
		scriptMs: ms(busy - renderingAndGc),
		gcMs: ms(covered(gc)),
		styleLayoutMs: ms(layoutAndGc - covered(gc)),
		paintMs: ms(renderingAndGc - layoutAndGc),
		otherAndFrameWaitMs: ms(end.ts - start.ts - busy),
	};
}
