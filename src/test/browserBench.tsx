import "../adapter/views/styles/global.css";
import "../adapter/views/styles/dashboard.css";
import "../adapter/views/styles/master.css";
import "../adapter/views/styles/review.css";
import "../adapter/views/styles/pages.css";
import { render } from "@solidjs/testing-library";
import type {} from "@vitest/browser-playwright";
import type { JSX } from "solid-js";
import { cdp, server } from "vitest/browser";
import { summarizeTrace, type TraceEvent } from "./browserTrace";

export const browserSamples = {
	iterations: 30,
	time: 0,
	warmupIterations: 5,
	warmupTime: 0,
};

// Second rAF starts after the preceding frame had a chance to paint. This is
// a frame-completion proxy, not INP or a hardware input-to-presentation metric.
export const painted = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

export function renderBench(view: () => JSX.Element) {
	return render(() => (
		<div class="app-shell">
			<div class="app-frame">
				<div class="dashboard-shell">
					<main class="dashboard-main">{view()}</main>
				</div>
			</div>
		</div>
	));
}

/** Record one separate operation; tracing overhead is excluded from bench statistics. */
export async function profileOperation(id: string, action: () => unknown | Promise<unknown>) {
	const session = cdp();
	const events: TraceEvent[] = [];
	const collect = ({ value }: { value: unknown[] }) => {
		events.push(...(value as TraceEvent[]));
	};
	session.on("Tracing.dataCollected", collect);
	await session.send("Tracing.start", {
		categories: "devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.cpu_profiler",
		transferMode: "ReportEvents",
	});
	try {
		await painted();
		performance.mark(`typa:${id}:start`);
		await action();
		await painted();
		performance.mark(`typa:${id}:end`);
	} finally {
		// Use on/off: Vitest 5.0.5's browser CDP once() removes its listener twice.
		const completed = new Promise<void>((resolve, reject) => {
			const onComplete = () => {
				clearTimeout(timeout);
				session.off("Tracing.tracingComplete", onComplete);
				resolve();
			};
			const timeout = setTimeout(() => {
				session.off("Tracing.tracingComplete", onComplete);
				reject(new Error("Chromium trace did not complete within 10 seconds"));
			}, 10_000);
			session.on("Tracing.tracingComplete", onComplete);
		});
		await session.send("Tracing.end");
		await completed;
		session.off("Tracing.dataCollected", collect);
	}
	const root = document.querySelector(".dashboard-main");
	const summary = {
		...summarizeTrace(events, id),
		environment: {
			solidRuntime: "production",
			userAgent: navigator.userAgent,
			viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
		},
		dom: {
			elements: root?.querySelectorAll("*").length ?? 0,
			rows: root?.querySelectorAll("tbody tr").length ?? 0,
			selects: root?.querySelectorAll("select").length ?? 0,
			options: root?.querySelectorAll("option").length ?? 0,
		},
	};
	const base = `.vitest/bench/browser/${id}`;
	await server.commands.writeFile(`${base}.trace.json`, JSON.stringify({ traceEvents: events }));
	await server.commands.writeFile(`${base}.summary.json`, JSON.stringify(summary, null, 2));
	console.info("Chromium operation profile", summary);
	return summary;
}
