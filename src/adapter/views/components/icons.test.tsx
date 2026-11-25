// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { Check, type Icon, Users } from "./icons";

afterEach(cleanup);

const svgOf = (Shape: Icon, props: Parameters<Icon>[0] = {}) =>
	render(() => <Shape {...props} />).container.querySelector("svg") as SVGSVGElement;

it("draws the lucide shape as SVG, so the browser paints it", () => {
	const svg = svgOf(Users);
	expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
	const shapes = [...svg.children];
	expect(shapes.length).toBeGreaterThan(1);
	for (const shape of shapes) {
		expect(shape.namespaceURI).toBe("http://www.w3.org/2000/svg");
	}
	expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
	expect(svg.getAttribute("stroke")).toBe("currentColor");
});

it("takes the size, class, stroke width and hiding from assistive technology", () => {
	const svg = svgOf(Check, {
		size: 14,
		class: "header-icon",
		"aria-hidden": "true",
		"stroke-width": 1.25,
	});
	expect(svg.getAttribute("width")).toBe("14");
	expect(svg.getAttribute("height")).toBe("14");
	expect(svg.getAttribute("class")).toBe("lucide header-icon");
	expect(svg.getAttribute("aria-hidden")).toBe("true");
	expect(svg.getAttribute("stroke-width")).toBe("1.25");
});

it("keeps the defaults when nothing is given", () => {
	const svg = svgOf(Check);
	expect(svg.getAttribute("width")).toBe("24");
	expect(svg.getAttribute("class")).toBe("lucide");
	// 飾りなので、何も書かなくても読み上げから隠す
	expect(svg.getAttribute("aria-hidden")).toBe("true");
	expect(svg.getAttribute("stroke-width")).toBe("2");
});
