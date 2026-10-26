import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import HelpView from "./HelpView";

afterEach(cleanup);

const show = () =>
	render(() => (
		<MemoryRouter>
			<Route path="/" component={HelpView} />
		</MemoryRouter>
	));

it("opens the matching manual image and returns focus when closed", async () => {
	const view = show();
	const opener = view.getByRole("button", { name: "目標の入力と保存を拡大" });
	opener.focus();
	fireEvent.click(opener);
	const dialog = await view.findByRole("dialog", { name: "目標の入力と保存" });
	const image = within(dialog).getByRole("img", { name: "目標の入力と保存" }) as HTMLImageElement;
	await waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
	expect(image.getAttribute("src")).toBe(
		(within(opener).getByRole("img") as HTMLImageElement).getAttribute("src"),
	);
	expect(dialog.contains(document.activeElement)).toBe(true);
	fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	expect(document.activeElement).toBe(opener);
});

it("uses topic images and the selected audience's screenshots", async () => {
	const view = show();
	fireEvent.click(
		view.getByText("前期のチャレンジ目標", { exact: true, selector: "summary, summary *" }),
	);
	fireEvent.click(view.getByRole("button", { name: "前期のチャレンジ目標を拡大" }));
	const previous = await view.findByRole("dialog", { name: "前期のチャレンジ目標" });
	fireEvent.click(within(previous).getByRole("button", { name: "閉じる" }));
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	fireEvent.click(view.getByRole("button", { name: /評価方法/ }));
	expect(view.queryByRole("button", { name: "目標の入力と保存を拡大" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "目標の採点を拡大" }));
	const scoring = await view.findByRole("dialog", { name: "目標の採点" });
	const image = within(scoring).getByRole("img") as HTMLImageElement;
	await waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
	await userEvent.keyboard("{Escape}");
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});
