// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	AuditLogController,
	AuditLogPageView,
	AuditLogQuery,
} from "../controllers/AuditLogController";
import type { AuditEntryView } from "../viewmodels/auditLog";
import AuditLogView from "./AuditLogView";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const entry = (overrides: Partial<AuditEntryView> = {}): AuditEntryView => ({
	id: 42,
	occurredAt: "2026-11-02T05:03:00Z",
	day: "2026-11-02",
	time: "14:03",
	category: "workflow",
	title: "目標を確定",
	seal: null,
	actor: { name: "一次 花子", employeeNo: "R002" },
	subject: {
		person: { name: "山田 花子", employeeNo: "E004" },
		periodName: "26期 上期",
		sheetId: 100,
		missing: null,
	},
	changes: [{ label: "状態", before: "目標確認待ち", after: "振り返り待ち" }],
	facts: [],
	reason: null,
	raw: '{\n  "from": "goals_submitted"\n}',
	...overrides,
});
const deleted = entry({
	id: 41,
	time: "13:58",
	category: "override",
	title: "シートを削除",
	seal: { glyph: "削", label: "シートの削除" },
	actor: { name: "管理 太郎", employeeNo: "A001" },
	subject: {
		person: { name: "山田 花子", employeeNo: "E004" },
		periodName: "25期 下期",
		sheetId: null,
		missing: null,
	},
	changes: [],
	facts: [{ label: "削除した目標", value: "3件" }],
	reason: "二重に作成したため",
});
const older = entry({
	id: 30,
	day: "2026-11-01",
	time: "09:00",
	occurredAt: "2026-11-01T00:00:00Z",
});

const OPTIONS = {
	targets: [
		{ id: 1, name: "管理 太郎", employeeNo: "A001" },
		{ id: 4, name: "山田 花子", employeeNo: "E004" },
	],
	actors: [{ id: 1, name: "管理 太郎", employeeNo: "A001" }],
};
const page = (entries: AuditEntryView[], next: number | null = null): AuditLogPageView => ({
	entries,
	hasMore: next !== null,
	next,
});

type Stub = { open: ReturnType<typeof vi.fn>; page: ReturnType<typeof vi.fn> };
function setup(controller: Partial<Stub> = {}) {
	const stub: Stub = {
		open: vi.fn().mockResolvedValue(OPTIONS),
		page: vi.fn().mockResolvedValue(page([entry(), deleted], 41)),
		...controller,
	};
	const view = render(() => <AuditLogView controller={stub as unknown as AuditLogController} />);
	return { ...view, controller: stub };
}
const lastQuery = (stub: { page: ReturnType<typeof vi.fn> }) =>
	stub.page.mock.calls.slice(-1)[0]?.[0] as AuditLogQuery;

it("shows the day's records as sentences, newest first, with the seal only on overrides", async () => {
	const view = setup();
	const day = await view.findByRole("region", { name: "2026年11月2日（月）" });
	const items = within(day).getAllByRole("listitem");
	expect(items.map((item) => within(item).getByRole("heading").textContent)).toEqual([
		"目標を確定",
		"シートを削除",
	]);
	const [step, removal] = items;
	expect(within(step).getByText("14:03").getAttribute("datetime")).toBe("2026-11-02T05:03:00Z");
	expect(within(step).queryByRole("img")).toBeNull();
	expect(within(removal).getByRole("img", { name: "検印：シートの削除" }).textContent).toBe("削");
	expect(removal.textContent).toContain("二重に作成したため");
	expect(removal.textContent).toContain("削除した目標");
	// 変更前は消し線、変更後は加筆として読み上げられる
	expect(step.querySelector("del")?.textContent).toBe("目標確認待ち");
	expect(step.querySelector("ins")?.textContent).toBe("振り返り待ち");
	expect(view.controller.page).toHaveBeenCalledWith(
		{ category: "all", since: "", until: "", actorEmployeeId: null, targetEmployeeId: null },
		null,
	);
});

it("links to a sheet that still exists, and not to a deleted one", async () => {
	const view = setup();
	const [step, removal] = within(
		await view.findByRole("region", { name: /2026年11月2日/ }),
	).getAllByRole("listitem");
	expect(
		within(step)
			.getByRole("link", { name: /シートを開く/ })
			.getAttribute("href"),
	).toBe("/sheet/100");
	expect(within(removal).queryByRole("link")).toBeNull();
});

it("shows the raw record as text, never as markup", async () => {
	const hostile = entry({ raw: '{"reason":"<img src=x onerror=alert(1)>"}', reason: "<b>x</b>" });
	const view = setup({ page: vi.fn().mockResolvedValue(page([hostile])) });
	const item = (await view.findAllByRole("listitem"))[0];
	expect(item.querySelector("img, b")).toBeNull();
	expect(item.textContent).toContain("<img src=x onerror=alert(1)>");
	expect(item.textContent).toContain("<b>x</b>");
});

describe("filters", () => {
	it("reads again from the newest record for a kind", async () => {
		const view = setup();
		await view.findAllByRole("listitem");
		fireEvent.click(view.getByRole("radio", { name: "遡及処理" }));
		await waitFor(() => expect(lastQuery(view.controller).category).toBe("override"));
		expect(view.controller.page.mock.calls.slice(-1)[0]?.[1]).toBeNull();
	});

	it("narrows by a day range", async () => {
		const view = setup();
		await view.findAllByRole("listitem");
		fireEvent.change(view.getByLabelText("期間の始まり"), { target: { value: "2026-11-01" } });
		await waitFor(() => expect(lastQuery(view.controller).since).toBe("2026-11-01"));
		fireEvent.change(view.getByLabelText("期間の終わり"), { target: { value: "2026-11-02" } });
		await waitFor(() => expect(lastQuery(view.controller).until).toBe("2026-11-02"));
	});

	it("narrows by the employee the records are about", async () => {
		const view = setup();
		await view.findAllByRole("listitem");
		(view.getByRole("combobox", { name: "対象の社員" }) as HTMLInputElement).focus();
		fireEvent.click(await within(document.body).findByRole("option", { name: /山田 花子/ }));
		await waitFor(() => expect(lastQuery(view.controller).targetEmployeeId).toBe(4));
	});

	it("offers only employees with an account as the one who acted", async () => {
		const view = setup();
		await view.findAllByRole("listitem");
		(view.getByRole("combobox", { name: "操作した人" }) as HTMLInputElement).focus();
		const options = (await within(document.body).findAllByRole("option")).map(
			(option) => option.textContent,
		);
		expect(options).toEqual(["すべて", "管理 太郎A001"]);
	});

	it("clears every filter at once", async () => {
		const view = setup();
		await view.findAllByRole("listitem");
		expect(view.queryByRole("button", { name: "絞り込みを解除" })).toBeNull();
		fireEvent.click(view.getByRole("radio", { name: "取込" }));
		fireEvent.click(await view.findByRole("button", { name: "絞り込みを解除" }));
		await waitFor(() => expect(lastQuery(view.controller).category).toBe("all"));
		expect((view.getByRole("radio", { name: "すべて" }) as HTMLInputElement).checked).toBe(true);
	});

	it("ignores a slower answer for a filter that was already replaced", async () => {
		let answerFirst!: (value: AuditLogPageView) => void;
		const pageFn = vi
			.fn()
			.mockResolvedValueOnce(page([entry()]))
			.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
			.mockResolvedValueOnce(page([older]));
		const view = setup({ page: pageFn });
		await view.findAllByRole("listitem");
		fireEvent.click(view.getByRole("radio", { name: "社員・アカウント" }));
		fireEvent.click(view.getByRole("radio", { name: "取込" }));
		await view.findByRole("region", { name: /2026年11月1日/ });
		answerFirst(page([deleted]));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(view.queryByText("シートを削除")).toBeNull();
		expect(view.getByRole("region", { name: /2026年11月1日/ })).toBeTruthy();
	});

	it("keeps the filter and says why when the controller refuses it", async () => {
		const pageFn = vi
			.fn()
			.mockResolvedValueOnce(page([entry()]))
			.mockRejectedValueOnce(new Error("期間の始まりが、終わりの日より後になっています。"));
		const view = setup({ page: pageFn });
		await view.findAllByRole("listitem");
		fireEvent.change(view.getByLabelText("期間の始まり"), { target: { value: "2026-12-01" } });
		expect((await view.findByRole("alert")).textContent).toContain("終わりの日より後");
		expect((view.getByLabelText("期間の始まり") as HTMLInputElement).value).toBe("2026-12-01");
	});
});

describe("paging", () => {
	it("appends older records below, continuing from the last one", async () => {
		const pageFn = vi
			.fn()
			.mockResolvedValueOnce(page([entry(), deleted], 41))
			.mockResolvedValueOnce(page([older]));
		const view = setup({ page: pageFn });
		fireEvent.click(await view.findByRole("button", { name: "さらに前の記録を読み込む" }));
		await view.findByRole("region", { name: /2026年11月1日/ });
		expect(pageFn.mock.calls.slice(-1)[0]?.[1]).toBe(41);
		expect(view.getAllByRole("listitem")).toHaveLength(3);
		expect(view.queryByRole("button", { name: "さらに前の記録を読み込む" })).toBeNull();
		expect(view.getByText("これより前の記録はありません。")).toBeTruthy();
	});

	it("keeps what it already shows when reading older records fails, and lets the user retry", async () => {
		const pageFn = vi
			.fn()
			.mockResolvedValueOnce(page([entry()], 42))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(page([older]));
		const view = setup({ page: pageFn });
		fireEvent.click(await view.findByRole("button", { name: "さらに前の記録を読み込む" }));
		expect((await view.findByRole("alert")).textContent).toContain("offline");
		expect(view.getAllByRole("listitem")).toHaveLength(1);
		fireEvent.click(view.getByRole("button", { name: "さらに前の記録を読み込む" }));
		await view.findByRole("region", { name: /2026年11月1日/ });
		expect(view.getAllByRole("listitem")).toHaveLength(2);
	});
});

describe("when there is nothing to show", () => {
	it("explains an empty log", async () => {
		const view = setup({ page: vi.fn().mockResolvedValue(page([])) });
		expect(await view.findByText(/まだ記録はありません/)).toBeTruthy();
	});

	it("offers to clear the filters when they match nothing", async () => {
		const pageFn = vi
			.fn()
			.mockResolvedValueOnce(page([entry()]))
			.mockResolvedValue(page([]));
		const view = setup({ page: pageFn });
		await view.findAllByRole("listitem");
		fireEvent.click(view.getByRole("radio", { name: "取込" }));
		expect(await view.findByText("この条件に合う記録はありません。")).toBeTruthy();
		expect(view.getAllByRole("button", { name: "絞り込みを解除" }).length).toBeGreaterThan(0);
	});
});

it("refuses non-Admins without showing filters or records", async () => {
	const view = setup({
		open: vi.fn().mockRejectedValue(new Error("監査ログは Admin のみ利用できます。")),
	});
	expect((await view.findByRole("alert")).textContent).toContain("Admin のみ");
	expect(view.queryByRole("radio")).toBeNull();
	expect(view.controller.page).not.toHaveBeenCalled();
});

it("says when the log cannot be read, and reads again on request", async () => {
	const pageFn = vi
		.fn()
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(page([entry()]));
	const view = setup({ page: pageFn });
	expect((await view.findByRole("alert")).textContent).toContain("offline");
	fireEvent.click(view.getByRole("button", { name: "もう一度読み込む" }));
	expect(await view.findAllByRole("listitem")).toHaveLength(1);
});
