import { describe, expect, it, vi } from "vitest";
import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";
import { masterRepository, period, profile, sheetRepository } from "../../test/fixtures";
import { AuditLogController, type AuditLogQuery } from "./AuditLogController";

const people = [
	{ id: 1, userId: "u-1", name: "管理 太郎", employeeNo: "A001" },
	{ id: 4, userId: "u-4", name: "山田 花子", employeeNo: "E004" },
	{ id: 7, userId: null, name: "佐藤 一郎", employeeNo: "E007" },
];
const indexed = (id: number, employeeId: number) => ({ id, employeeId, periodId: 10 });
const all: AuditLogQuery = {
	category: "all",
	since: "",
	until: "",
	actorEmployeeId: null,
	targetEmployeeId: null,
};

function setup(actor = profile("Admin")) {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(actor);
	employees.findGrades.mockResolvedValue([{ id: 1, name: "一般1級" }]);
	const periods = { findDistinctPeriods: vi.fn().mockResolvedValue([period()]) };
	const sheets = sheetRepository();
	sheets.findOverviewIndex.mockResolvedValue({
		periods: [{ id: 10, name: "テスト期間 上期", startDate: "2026-04-01" }],
		sheets: [indexed(100, 4), indexed(101, 4), indexed(200, 7)],
	});
	const log = {
		findPage: vi.fn<AuditLogRepository["findPage"]>().mockResolvedValue({
			hasMore: true,
			records: [
				{
					id: 42,
					occurredAt: "2026-11-02T05:03:00Z",
					actorUserId: "u-4",
					action: "sheet.status",
					entityId: 100,
					details: { from: "draft", to: "goals_submitted" },
				},
			],
		}),
		findPeople: vi.fn<AuditLogRepository["findPeople"]>().mockResolvedValue(people),
		findRoleNames: vi.fn<AuditLogRepository["findRoleNames"]>().mockResolvedValue(new Map()),
	};
	const controller = new AuditLogController(employees, periods, sheets, log, "Asia/Tokyo");
	return { controller, employees, periods, sheets, log };
}

describe("who may open the audit log", () => {
	it.each(["Reviewer", "Employee"])(
		"refuses %s before reading anything, even by direct URL",
		async (role) => {
			const { controller, log, sheets, periods } = setup(profile(role));
			await expect(controller.open()).rejects.toThrow("Admin");
			expect(log.findPeople).not.toHaveBeenCalled();
			expect(log.findPage).not.toHaveBeenCalled();
			expect(sheets.findOverviewIndex).not.toHaveBeenCalled();
			expect(periods.findDistinctPeriods).not.toHaveBeenCalled();
		},
	);

	it("refuses a suspended Admin", async () => {
		const { controller, log } = setup(Object.assign(profile("Admin"), { enabled: false }));
		await expect(controller.open()).rejects.toThrow("Admin");
		expect(log.findPeople).not.toHaveBeenCalled();
	});

	it("refuses when nobody is signed in", async () => {
		const { controller, employees, log } = setup();
		employees.findCurrentEmployeeProfile.mockResolvedValue(null);
		await expect(controller.open()).rejects.toThrow("Admin");
		expect(log.findPeople).not.toHaveBeenCalled();
	});

	it("does not read the log before the page has been opened", async () => {
		const { controller, log } = setup();
		await expect(controller.page(all, null)).rejects.toThrow();
		expect(log.findPage).not.toHaveBeenCalled();
	});

	it("does not read the log after opening was refused", async () => {
		const { controller, log } = setup(profile("Reviewer"));
		await expect(controller.open()).rejects.toThrow();
		await expect(controller.page(all, null)).rejects.toThrow();
		expect(log.findPage).not.toHaveBeenCalled();
	});
});

it("offers every employee as a target and only employees with an account as the actor", async () => {
	const { controller } = setup();
	expect(await controller.open()).toEqual({
		targets: [
			{ id: 1, name: "管理 太郎", employeeNo: "A001" },
			{ id: 4, name: "山田 花子", employeeNo: "E004" },
			{ id: 7, name: "佐藤 一郎", employeeNo: "E007" },
		],
		actors: [
			{ id: 1, name: "管理 太郎", employeeNo: "A001" },
			{ id: 4, name: "山田 花子", employeeNo: "E004" },
		],
	});
});

it("reads the newest page and names the people in it", async () => {
	const { controller, log, sheets } = setup();
	await controller.open();
	const page = await controller.page(all, null);
	// シートの名寄せは軽い索引で行い、全社のシートの中身は読まない
	expect(sheets.findOverview).not.toHaveBeenCalled();
	expect(log.findPage).toHaveBeenCalledWith({}, null, 100);
	expect(page.hasMore).toBe(true);
	expect(page.next).toBe(42);
	expect(page.entries[0]).toMatchObject({
		id: 42,
		time: "14:03",
		title: "目標を送信",
		actor: { name: "山田 花子" },
		subject: { sheetId: 100, periodName: "テスト期間 上期" },
	});
});

it("continues from the record it stopped at", async () => {
	const { controller, log } = setup();
	await controller.open();
	await controller.page(all, 42);
	expect(log.findPage).toHaveBeenCalledWith({}, 42, 100);
});

it("turns the filters into the kinds, local days, account and the target's sheets", async () => {
	const { controller, log } = setup();
	await controller.open();
	await controller.page(
		{
			category: "override",
			since: "2026-11-01",
			until: "2026-11-02",
			actorEmployeeId: 1,
			targetEmployeeId: 4,
		},
		null,
	);
	expect(log.findPage).toHaveBeenCalledWith(
		{
			actions: [
				"sheet.corrected",
				"sheet.privileged_status",
				"sheet.privileged_delete",
				"sheet.grade_change",
			],
			// 終わりの日は、その日の終わりまで含める
			since: new Date("2026-11-01T00:00:00").toISOString(),
			until: new Date("2026-11-03T00:00:00").toISOString(),
			actorUserId: "u-1",
			target: { employeeId: 4, sheetIds: [100, 101] },
		},
		null,
		100,
	);
});

it.each([
	[{ since: "2026-11-03", until: "2026-11-01" }, "始まり"],
	[{ since: "2026-13-40" }, "日付"],
	[{ actorEmployeeId: 7 }, "操作した人"],
	[{ actorEmployeeId: 999 }, "操作した人"],
	[{ targetEmployeeId: 999 }, "対象の社員"],
])("refuses the filter %j without asking the database", async (filter, message) => {
	const { controller, log } = setup();
	await controller.open();
	await expect(controller.page({ ...all, ...filter }, null)).rejects.toThrow(message);
	expect(log.findPage).not.toHaveBeenCalled();
});

it("lets a database failure through instead of showing an empty log", async () => {
	const { controller, log } = setup();
	await controller.open();
	log.findPage.mockRejectedValueOnce(new Error("permission denied"));
	await expect(controller.page(all, null)).rejects.toThrow("permission denied");
});

it("reports the end when no record is left", async () => {
	const { controller, log } = setup();
	await controller.open();
	log.findPage.mockResolvedValueOnce({ hasMore: false, records: [] });
	expect(await controller.page(all, null)).toEqual({ entries: [], hasMore: false, next: null });
});
