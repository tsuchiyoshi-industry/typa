// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { EVALUATION_STATUS_VALUES } from "../../../domain/valueObjects/EvaluationStatus";
import StatusChip from "./StatusChip";

afterEach(cleanup);

it("gives every status its own shape, so it never depends on color alone", () => {
	const shapes = EVALUATION_STATUS_VALUES.map((status) => {
		const { container } = render(() => <StatusChip status={status} />);
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("aria-hidden")).toBe("true");
		const shape = svg?.innerHTML ?? "";
		cleanup();
		return shape;
	});
	expect(new Set(shapes).size).toBe(EVALUATION_STATUS_VALUES.length);
});
