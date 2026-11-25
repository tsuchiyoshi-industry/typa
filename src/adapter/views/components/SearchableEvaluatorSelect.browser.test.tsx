import "../styles/global.css";
import "../styles/master.css";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import SearchableEvaluatorSelect from "./SearchableEvaluatorSelect";

afterEach(cleanup);

it("keeps a long list above a bottom-right input and inside the viewport", async () => {
	await page.viewport(390, 500);
	const options = Array.from({ length: 20 }, (_, index) => ({
		name: `社員${index}`,
		value: String(index),
	}));
	const pick = vi.fn().mockResolvedValue(true);
	render(() => (
		<div style="position: fixed; right: 5px; bottom: 10px; width: 140px">
			<SearchableEvaluatorSelect
				label="評価者"
				value=""
				options={options}
				disabled={false}
				saving={false}
				onPick={pick}
			/>
		</div>
	));
	const input = screen.getByRole("combobox");
	await userEvent.click(input);
	const menu = screen.getByRole("listbox").parentElement as HTMLElement;
	expect(menu.matches(":popover-open")).toBe(true);
	const rect = menu.getBoundingClientRect();
	expect(rect.bottom).toBeLessThanOrEqual(input.getBoundingClientRect().top);
	expect(rect.left).toBeGreaterThanOrEqual(0);
	expect(rect.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
	await userEvent.keyboard("{ArrowDown}{Enter}");
	expect(pick).toHaveBeenCalledExactlyOnceWith("1");
	expect(screen.queryByRole("listbox")).toBeNull();
});
