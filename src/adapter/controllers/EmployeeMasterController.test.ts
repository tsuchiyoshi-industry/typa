import { describe, expect, it, vi } from "vitest";
import { EmployeeMasterController } from "./EmployeeMasterController";

// 社員マスタの変更は、どれも同じ扱い: できたら一覧を読み直して true。断られたら・失敗したら false で、
// 画面は選択を元に戻す(読み直さない)
function setup() {
	const useCase = () => ({ execute: vi.fn().mockResolvedValue(undefined) });
	const cases = {
		load: useCase(),
		evaluator: useCase(),
		grade: useCase(),
		role: useCase(),
		reset: useCase(),
		keepSignedIn: useCase(),
		enabled: useCase(),
		invitation: useCase(),
		pending: useCase(),
		preRegister: useCase(),
	};
	let success = true;
	const presenter = {
		viewModel: () => ({ updateStatus: { success } }),
		outputPort: { load: {}, update: {}, updateEnabled: {}, issueInvitation: {} },
		beginLoad: vi.fn(),
		dismissInvitation: vi.fn(),
		presentError: vi.fn(),
	};
	const controller = new EmployeeMasterController(
		cases.load as never,
		cases.evaluator as never,
		cases.grade as never,
		cases.role as never,
		cases.reset as never,
		cases.keepSignedIn as never,
		cases.enabled as never,
		cases.invitation as never,
		cases.pending as never,
		cases.preRegister as never,
		presenter as never,
	);
	return { controller, cases, presenter, refuse: () => (success = false) };
}
type Context = ReturnType<typeof setup>;

describe.each([
	[
		"an evaluator",
		"evaluator",
		(c: Context) => c.controller.updateEvaluator("E2", "A1", "primary"),
		"評価者の更新に失敗しました",
	],
	[
		"a grade",
		"grade",
		(c: Context) => c.controller.updateGrade("E2", 2),
		"等級の更新に失敗しました",
	],
	[
		"a role",
		"role",
		(c: Context) => c.controller.updateRole("E2", "Reviewer"),
		"権限の変更に失敗しました",
	],
	[
		"keeping the sign-in",
		"keepSignedIn",
		(c: Context) => c.controller.updateKeepSignedIn("E2", true),
		"ログイン状態の保持を変更できませんでした",
	],
	[
		"a registration reset",
		"reset",
		(c: Context) => c.controller.resetRegistration("E2"),
		"登録の取り消しに失敗しました",
	],
	[
		"the use of the app",
		"enabled",
		(c: Context) => c.controller.updateEnabled("E2", false),
		"利用状態を変更できませんでした",
	],
	[
		"a pre-registration",
		"preRegister",
		(c: Context) => c.controller.preRegister({} as never),
		"仮登録できませんでした",
	],
] as const)("changing %s", (_label, useCase, change, fallback) => {
	it("reloads the list after it is done", async () => {
		const context = setup();
		expect(await change(context)).toBe(true);
		expect(context.cases[useCase].execute).toHaveBeenCalledOnce();
		expect(context.cases.load.execute).toHaveBeenCalledOnce();
	});

	it("keeps the list as it was when the change was refused", async () => {
		const context = setup();
		context.refuse();
		expect(await change(context)).toBe(false);
		expect(context.cases.load.execute).not.toHaveBeenCalled();
	});

	it.each([
		[new Error("permission denied"), "permission denied"],
		["not an Error", fallback],
	])("reports a failure on the way (%s)", async (failure, message) => {
		const context = setup();
		context.cases[useCase].execute.mockRejectedValue(failure);
		expect(await change(context)).toBe(false);
		expect(context.presenter.presentError).toHaveBeenCalledWith(message);
		expect(context.cases.load.execute).not.toHaveBeenCalled();
	});
});

describe("loading and invitations", () => {
	it("says the master could not be read, instead of showing an empty company", async () => {
		const context = setup();
		context.cases.load.execute.mockRejectedValue(new Error("network"));
		await context.controller.load();
		expect(context.presenter.beginLoad).toHaveBeenCalledOnce();
		expect(context.presenter.presentError).toHaveBeenCalledWith("network");
	});

	it.each([
		["one invitation", (c: Context) => c.controller.issueInvitation("E2"), "invitation"],
		["every pending invitation", (c: Context) => c.controller.issuePendingInvitations(), "pending"],
	] as const)(
		"issues %s without reloading, and says when it could not",
		async (_label, issue, useCase) => {
			const context = setup();
			await issue(context);
			expect(context.cases[useCase].execute).toHaveBeenCalledOnce();
			expect(context.cases.load.execute).not.toHaveBeenCalled();
			context.cases[useCase].execute.mockRejectedValue("network");
			await issue(context);
			expect(context.presenter.presentError).toHaveBeenCalledWith(
				"招待コードを発行できませんでした",
			);
		},
	);
});
