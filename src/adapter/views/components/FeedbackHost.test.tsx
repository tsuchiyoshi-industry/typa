// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { clearToasts, confirmAction, settleConfirm, showToast } from "../feedback";
import FeedbackHost from "./FeedbackHost";

afterEach(() => {
	cleanup();
	// 通知は画面をまたいで残る。次のテストに持ち越さない
	clearToasts();
});

it("通知のボタンを押すと、その操作をして通知を閉じる", async () => {
	const run = vi.fn();
	render(() => <FeedbackHost />);
	showToast("success", "PDFを保存しました", "C:\\a.pdf", { label: "フォルダを開く", run });

	fireEvent.click(await screen.findByRole("button", { name: "フォルダを開く" }));

	expect(run).toHaveBeenCalledOnce();
	await waitFor(() => expect(screen.queryByText("PDFを保存しました")).toBeNull());
});

it("書く欄のある確認は、1〜上限の文字数のときだけ実行でき、誰が読むかを欄のそばに出す", async () => {
	const onInput = vi.fn();
	render(() => <FeedbackHost />);
	const answer = confirmAction({
		title: "戻しますか？",
		message: "本文",
		text: {
			label: "理由（必須）",
			audience: "この理由は本人に表示されます。",
			maxLength: 5,
			lengthOf: (text) => [...text.trim()].length,
			onInput,
		},
		confirmLabel: "戻す",
	});
	const field = await screen.findByRole("textbox", { name: /理由（必須）/ });
	const confirm = screen.getByRole("button", { name: "戻す" }) as HTMLButtonElement;
	expect(field.getAttribute("aria-describedby")).toContain("confirm-dialog-audience");
	expect(screen.getByText("この理由は本人に表示されます。")).toBeTruthy();
	expect(confirm.disabled).toBe(true);

	fireEvent.input(field, { target: { value: " 　\n" } });
	expect(confirm.disabled).toBe(true);
	fireEvent.input(field, { target: { value: "123456" } });
	expect(confirm.disabled).toBe(true);
	expect(screen.getByText(/1 文字多すぎます/)).toBeTruthy();
	expect(field.getAttribute("aria-invalid")).toBe("true");

	fireEvent.input(field, { target: { value: "12345" } });
	expect(confirm.disabled).toBe(false);
	expect(onInput).toHaveBeenLastCalledWith("12345");
	fireEvent.click(confirm);
	expect(await answer).toBe(true);
});

it("前に書いた文を入れて開き、その長さで実行できるかを決める", async () => {
	render(() => <FeedbackHost />);
	void confirmAction({
		title: "戻しますか？",
		message: "本文",
		text: {
			label: "理由",
			audience: "本人に表示されます。",
			initial: "前の理由",
			maxLength: 200,
			lengthOf: (text) => text.trim().length,
			onInput: () => {},
		},
		confirmLabel: "戻す",
	});
	expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("前の理由");
	expect((screen.getByRole("button", { name: "戻す" }) as HTMLButtonElement).disabled).toBe(false);
	settleConfirm(false);
});
