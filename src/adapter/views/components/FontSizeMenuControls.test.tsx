// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { applyStoredFontSize } from "../fontSize";
import FontSizeMenuControls from "./FontSizeMenuControls";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
});

describe("font size menu controls", () => {
	it("increases and decreases the stored application font size", () => {
		const view = render(() => <FontSizeMenuControls />);

		fireEvent.click(view.getByRole("button", { name: "文字を大きくする" }));
		expect(document.documentElement.style.fontSize).toBe("17px");
		expect(window.localStorage.getItem("typa:font-size")).toBe("17");

		fireEvent.click(view.getByRole("button", { name: "文字を小さくする" }));
		expect(document.documentElement.style.fontSize).toBe("16px");
	});

	it("restores a saved size and enforces the supported limits", () => {
		window.localStorage.setItem("typa:font-size", "22");
		applyStoredFontSize();
		const view = render(() => <FontSizeMenuControls />);

		expect(document.documentElement.style.fontSize).toBe("22px");
		expect(view.getByRole("button", { name: "文字を大きくする" }).hasAttribute("disabled")).toBe(
			true,
		);
		fireEvent.click(view.getByRole("button", { name: "文字を小さくする" }));
		expect(document.documentElement.style.fontSize).toBe("21px");

		window.localStorage.setItem("typa:font-size", "99");
		applyStoredFontSize();
		expect(document.documentElement.style.fontSize).toBe("16px");
	});
});
