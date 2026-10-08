// @vitest-environment jsdom
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { expect, it, vi } from "vitest";
import ScoreScale from "./ScoreScale";

it("keeps the chosen score when it is pressed again, so a double click never clears it", () => {
	const onChange = vi.fn();
	const [value, setValue] = createSignal(0);
	const view = render(() => (
		<ScoreScale
			label="業務遂行"
			max={4}
			value={value()}
			onChange={(next) => {
				onChange(next);
				setValue(next);
			}}
		/>
	));
	const three = view.getByRole("button", { name: "業務遂行 3" });
	fireEvent.click(three);
	fireEvent.click(three);
	expect(onChange.mock.calls).toEqual([[3]]);
	expect(three.getAttribute("aria-pressed")).toBe("true");
	fireEvent.click(view.getByRole("button", { name: "業務遂行 2" }));
	expect(value()).toBe(2);
});
