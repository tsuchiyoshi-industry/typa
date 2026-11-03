import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import HelpView, { type HelpSettings } from "./HelpView";

// 画面写真は CI が撮るので、手元には無いことがある。テストでは 1px の画像を写真として渡す
const PIXEL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

afterEach(cleanup);

// モックではなく、写真の探し方と設定の読み方を直接渡す(ブラウザのテストでは、モジュールの差し替えが外れることがある)
const show = (
	options: {
		shot?: (name: string) => string | undefined;
		settings?: () => Promise<HelpSettings>;
	} = {},
) =>
	render(() => (
		<HelpView
			shot={options.shot ?? (() => PIXEL)}
			settings={options.settings ?? (() => new Promise(() => {}))}
		/>
	));

it("walks through every sheet state in order, with the person who holds it", () => {
	const view = show();
	const table = view.getByRole("table", { name: "シートの状態と担当" });
	const rows = within(table).getAllByRole("row").slice(1);
	expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(
		EvaluationStatus.ALL.map((status) => status.label()),
	);
	// 下書きは本人、一次評価待ちは一次評価者、評価確定は誰も持たない
	expect(rows[0].textContent).toContain("本人");
	expect(rows[3].textContent).toContain("一次評価者");
	expect(rows[5].textContent).toContain("なし");
	expect(view.getByRole("img", { name: "評価シートの状態と、ボールを持つ人" })).toBeTruthy();
});

it("lists who is notified from the handoff rules, and says the final step notifies no one", () => {
	const view = show();
	const list = view.getByRole("list", { name: "通知の宛先" });
	const items = within(list).getAllByRole("listitem");
	expect(items).toHaveLength(EvaluationStatus.ALL.filter((status) => status.handoff()).length);
	expect(items.map((item) => item.textContent)).toContain("本人が「目標を送信する」一次評価者");
	expect(items.map((item) => item.textContent)).toContain(
		"一次評価者が「一次評価を確定する」二次評価者",
	);
	expect(view.getByText(/評価確定.*誰にも通知しません/)).toBeTruthy();
});

it("explains the score with the company's allocation and goal limit", async () => {
	const view = show({
		settings: async () => ({ objective: 30, common: 70, maxChallengeGoals: 5 }),
	});
	const score = view.getByRole("region", { name: "評価点・ランクと結果" });
	// 30 × 4/4 + 70 × 17/20 = 30 + 59.5 → 30 + 60 = 90 点(A)
	await waitFor(() => expect(score.textContent).toContain("90 点（A）"));
	expect(score.textContent).toContain("いまの配点");
	expect(view.getByText(/1〜5 件/)).toBeTruthy();
});

it("falls back to the default allocation as an example when the settings cannot be read", async () => {
	const failed = Promise.reject(new Error("offline"));
	failed.catch(() => {});
	const view = show({ settings: () => failed });
	const score = view.getByRole("region", { name: "評価点・ランクと結果" });
	await waitFor(() => expect(score.textContent).toContain("88 点（B+）"));
	expect(score.textContent).toContain("配点の例");
});

it("keeps every table-of-contents link pointing at a chapter", () => {
	const view = show();
	// 横の「章の移動」は広い画面だけに出す(テストの画面では隠れていて、役割では引けない)
	const navs = [...view.container.querySelectorAll("nav")];
	expect(navs.map((nav) => nav.getAttribute("aria-label")).sort()).toEqual(
		["目次", "章の移動"].sort(),
	);
	for (const nav of navs) {
		const links = [...nav.querySelectorAll("a")];
		expect(links.length).toBeGreaterThanOrEqual(9);
		for (const link of links) {
			const id = link.getAttribute("href")?.replace(/^#/, "") ?? "";
			expect(document.getElementById(id), id).not.toBeNull();
		}
	}
});

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
	fireEvent.click(view.getByRole("button", { name: "チャレンジ目標の採点を拡大" }));
	await view.findByRole("dialog", { name: "チャレンジ目標の採点" });
	await userEvent.keyboard("{Escape}");
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

it("still explains every chapter when the screenshots have not been taken", () => {
	const shot = vi.fn(() => undefined);
	const view = show({ shot });
	for (const chapter of ["シートの流れ", "目標を書く", "評価する", "期の終わりと次の期"]) {
		expect(view.getByRole("heading", { name: chapter, level: 2 })).toBeTruthy();
	}
	expect(view.container.querySelector("img")).toBeNull();
	expect(view.queryByRole("button", { name: /を拡大$/ })).toBeNull();
	expect(shot).toHaveBeenCalledWith("user/07-goal");
});
