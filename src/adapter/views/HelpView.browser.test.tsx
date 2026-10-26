import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import HelpView from "./HelpView";
import { helpShot } from "./helpShots";

// 画面写真は CI が撮るので、手元には無いことがある。テストでは 1px の画像を写真として渡す
const PIXEL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
vi.mock("./helpShots", () => ({ helpShot: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.mocked(helpShot).mockReset();
});

const show = () =>
	render(() => (
		<MemoryRouter>
			<Route path="/" component={HelpView} />
		</MemoryRouter>
	));

it("opens the matching manual image and returns focus when closed", async () => {
	vi.mocked(helpShot).mockReturnValue(PIXEL);
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
	vi.mocked(helpShot).mockReturnValue(PIXEL);
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

it("still explains every step when the screenshots have not been taken", () => {
	vi.mocked(helpShot).mockReturnValue(undefined);
	const view = show();
	expect(view.getByRole("heading", { name: "目標を記入・保存する" })).toBeTruthy();
	expect(view.queryByRole("img")).toBeNull();
	expect(view.queryByRole("button", { name: /を拡大$/ })).toBeNull();
	expect(vi.mocked(helpShot)).toHaveBeenCalledWith("user/07-goal");
});
