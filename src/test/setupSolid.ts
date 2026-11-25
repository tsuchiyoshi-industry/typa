import "./setupSolidEvents";
import { type DiagnosticEvent, OBSERVE } from "solid-js";
import { afterEach, expect } from "vitest";

// 開発版の Solid が見つけた誤用(追跡されない読み取り、所有スコープでの書き込み、確定していない入力の上書き、
// Loading の外の非同期など)は、コンソールに出るだけで動きは続く。見落とさないよう、そのテストの失敗にする。
let found: DiagnosticEvent[] = [];
OBSERVE?.diagnostics.subscribe((event) => {
	if (event.severity !== "info") {
		found.push(event);
	}
});
afterEach(() => {
	const events = found;
	found = [];
	expect(
		events.map((event) =>
			[`[${event.code}]`, event.nodeName, event.ownerPath?.join(" › "), event.loc]
				.filter(Boolean)
				.join(" "),
		),
		"Solid の診断",
	).toEqual([]);
});
