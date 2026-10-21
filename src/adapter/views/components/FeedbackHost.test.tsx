// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { showToast } from "../feedback";
import FeedbackHost from "./FeedbackHost";

afterEach(cleanup);

it("通知のボタンを押すと、その操作をして通知を閉じる", async () => {
	const run = vi.fn();
	render(() => <FeedbackHost />);
	showToast("success", "PDFを保存しました", "C:\\a.pdf", { label: "フォルダを開く", run });

	fireEvent.click(await screen.findByRole("button", { name: "フォルダを開く" }));

	expect(run).toHaveBeenCalledOnce();
	await waitFor(() => expect(screen.queryByText("PDFを保存しました")).toBeNull());
});
