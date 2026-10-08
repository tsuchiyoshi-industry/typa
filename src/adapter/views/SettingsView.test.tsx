// @vitest-environment jsdom
import { A, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateEvaluationAllocationInteractor } from "../../application/usecases/UpdateEvaluationAllocationInteractor";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { masterRepository, profile } from "../../test/fixtures";
import { SettingsController } from "../controllers/SettingsController";
import { confirmAction, confirmDiscard, showToast } from "./feedback";
import HelpView from "./HelpView";
import SettingsView from "./SettingsView";

vi.mock("./feedback", () => ({
	confirmAction: vi.fn().mockResolvedValue(true),
	confirmDiscard: vi.fn().mockResolvedValue(false),
	showToast: vi.fn(),
	trackUnsaved: vi.fn(),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function setup(role = "Admin") {
	const settings = {
		findAllocation: vi.fn().mockResolvedValue(EvaluationAllocation.DEFAULT),
		saveAllocation: vi.fn().mockResolvedValue(true),
	};
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 9));
	const controller = new SettingsController(
		settings,
		employees,
		new UpdateEvaluationAllocationInteractor(settings, employees),
	);
	return { settings, controller };
}
const number = (view: ReturnType<typeof render>, name: string) =>
	view.getByRole("spinbutton", { name }) as HTMLInputElement;
const renderSettings = (controller: SettingsController) =>
	render(() => (
		<MemoryRouter
			root={(props) => (
				<>
					<A href="/away">別の画面へ</A>
					{props.children}
				</>
			)}
		>
			<Route
				path="/"
				component={() => (
					<SettingsView
						controller={controller}
						periodController={{
							load: vi.fn().mockResolvedValue([]),
							save: vi.fn(),
							remove: vi.fn(),
							close: vi.fn(),
						}}
					/>
				)}
			/>
			<Route path="/away" component={() => <p>移動しました</p>} />
		</MemoryRouter>
	));

describe("settings", () => {
	it("asks before leaving unsaved settings", async () => {
		const { settings, controller } = setup();
		const view = renderSettings(controller);
		await view.findByRole("heading", { name: "評価点の配点" });
		fireEvent.input(number(view, "チャレンジ目標"), { target: { value: "31" } });
		fireEvent.click(view.getByRole("link", { name: "別の画面へ" }));
		await waitFor(() => expect(confirmDiscard).toHaveBeenCalledWith(true));
		expect(number(view, "チャレンジ目標").value).toBe("31");
		vi.mocked(confirmDiscard).mockResolvedValueOnce(true);
		fireEvent.click(view.getByRole("link", { name: "別の画面へ" }));
		await view.findByText("移動しました");
		expect(settings.saveAllocation).not.toHaveBeenCalled();
	});
	it("keeps the allocation at 100 points and saves it after confirmation", async () => {
		const { settings, controller } = setup();
		const view = renderSettings(controller);
		await view.findByRole("heading", { name: "評価点の配点" });
		expect(number(view, "チャレンジ目標").value).toBe("20");
		const save = view.getByRole("button", { name: "配点を保存する" }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);

		// 片方を変えると、もう片方が残りの点数になる
		fireEvent.input(number(view, "チャレンジ目標"), { target: { value: "30" } });
		expect(number(view, "共通評価").value).toBe("70");
		expect(view.getByText(/どちらも 4 点 → 30 点/)).toBeTruthy();
		fireEvent.input(number(view, "共通評価"), { target: { value: "65" } });
		expect(number(view, "チャレンジ目標").value).toBe("35");

		// 入力の途中や範囲外では保存できない
		fireEvent.input(number(view, "チャレンジ目標"), { target: { value: "120" } });
		expect(save.disabled).toBe(true);
		expect(view.getByRole("alert").textContent).toContain("合計が 100 点");

		fireEvent.input(number(view, "チャレンジ目標"), { target: { value: "25" } });
		vi.mocked(confirmAction).mockResolvedValueOnce(false);
		fireEvent.click(save);
		await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
		expect(settings.saveAllocation).not.toHaveBeenCalled();
		await waitFor(() => expect(save.disabled).toBe(false));
		fireEvent.click(save);
		await waitFor(() =>
			expect(settings.saveAllocation).toHaveBeenCalledWith(EvaluationAllocation.of(25, 75)),
		);
		await waitFor(() => expect(save.disabled).toBe(true));
		expect(showToast).toHaveBeenCalledWith("success", expect.stringContaining("25 点"));
	});
	it.each(["Reviewer", "Employee"])("is not available to %s", async (role) => {
		const { settings, controller } = setup(role);
		const view = renderSettings(controller);
		await view.findByText("設定は Admin のみ利用できます。");
		expect(view.queryByRole("spinbutton")).toBeNull();
		// 画面を迂回して保存を呼んでも、Admin でなければ保存しない
		expect(await controller.saveAllocation(50, 50)).toMatchObject({ success: false });
		expect(settings.saveAllocation).not.toHaveBeenCalled();
	});
	it("rejects an invalid allocation and reports a save the database refused", async () => {
		const { settings, controller } = setup();
		expect(await controller.saveAllocation(50, 60)).toMatchObject({
			success: false,
			message: expect.stringContaining("合計を 100"),
		});
		expect(settings.saveAllocation).not.toHaveBeenCalled();
		settings.saveAllocation.mockResolvedValueOnce(false);
		expect(await controller.saveAllocation(50, 50)).toEqual({
			success: false,
			message: "配点を保存できませんでした。",
		});
		settings.saveAllocation.mockRejectedValueOnce(new Error("offline"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await controller.saveAllocation(50, 50)).toMatchObject({ success: false });
	});
	it("keeps failed edits available for retry and reset", async () => {
		const { settings, controller } = setup();
		settings.saveAllocation.mockResolvedValueOnce(false);
		const view = renderSettings(controller);
		await view.findByRole("heading", { name: "評価点の配点" });
		fireEvent.input(number(view, "チャレンジ目標"), { target: { value: "31" } });
		fireEvent.click(view.getByRole("button", { name: "配点を保存する" }));
		await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)));
		expect(number(view, "チャレンジ目標").value).toBe("31");
		fireEvent.click(view.getByRole("button", { name: "元に戻す" }));
		expect(number(view, "チャレンジ目標").value).toBe("20");
		expect(number(view, "共通評価").value).toBe("80");
	});
	it("blocks duplicate submission and edits during confirmation", async () => {
		const { settings, controller } = setup();
		let confirm!: (value: boolean) => void;
		vi.mocked(confirmAction).mockReturnValueOnce(
			new Promise((resolve) => {
				confirm = resolve;
			}),
		);
		const view = renderSettings(controller);
		await view.findByRole("heading", { name: "評価点の配点" });
		fireEvent.input(number(view, "チャレンジ目標"), { target: { value: "31" } });
		fireEvent.click(view.getByRole("button", { name: "配点を保存する" }));
		expect(number(view, "チャレンジ目標").disabled).toBe(true);
		fireEvent.click(view.getByRole("button", { name: "確認中..." }));
		expect(confirmAction).toHaveBeenCalledTimes(1);
		confirm(true);
		await waitFor(() => expect(settings.saveAllocation).toHaveBeenCalledOnce());
		expect(settings.saveAllocation).toHaveBeenCalledWith(EvaluationAllocation.of(31, 69));
	});
});

describe("help", () => {
	const renderHelp = () =>
		render(() => (
			<MemoryRouter>
				<Route path="/" component={HelpView} />
			</MemoryRouter>
		));
	it("guides employees without loading administrative settings", () => {
		const view = renderHelp();
		expect(view.getByRole("button", { name: /記入方法/ }).getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(view.getByRole("link", { name: "評価シート一覧へ" }).getAttribute("href")).toBe("/");
		expect(view.getByRole("heading", { name: "記入方法について" })).toBeTruthy();
		expect(
			view.getByText("保存だけでは提出されません。提出するまでは、評価者に内容は表示されません。"),
		).toBeTruthy();
		expect(view.getByText("期間内に目指すこと")).toBeTruthy();
		expect(view.queryByText("社員マスタと権限")).toBeNull();
	});
	it("switches the steps, examples, questions and destination for reviewers", () => {
		const view = renderHelp();
		fireEvent.click(view.getByRole("button", { name: /評価方法/ }));
		expect(view.getByRole("button", { name: /評価方法/ }).getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(view.getByRole("heading", { name: "評価方法について" })).toBeTruthy();
		expect(view.getByRole("link", { name: "部下の評価へ" }).getAttribute("href")).toBe("/review");
		const question = view.getByText("確定ボタンを押せない");
		fireEvent.click(question);
		expect(question.closest("details")?.open).toBe(true);
		expect(view.queryByText("期間内に目指すこと")).toBeNull();
		fireEvent.click(view.getByRole("button", { name: /記入方法/ }));
		expect(view.getByText("期間内に目指すこと")).toBeTruthy();
		expect(view.queryByText("確定ボタンを押せない")).toBeNull();
	});
});
