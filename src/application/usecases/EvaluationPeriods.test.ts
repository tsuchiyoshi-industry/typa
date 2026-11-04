import { describe, expect, it } from "vitest";
import { EvaluationPeriodController } from "../../adapter/controllers/EvaluationPeriodController";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import type { EvaluationPeriodPlan } from "../../domain/entities/EvaluationPeriodPlan";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { SheetCountsByStatus } from "../../domain/valueObjects/SheetCountsByStatus";
import {
	commonRepository,
	employeeRepository,
	masterRepository,
	milestoneRepository,
	output,
	periodRepository,
	profile,
	sheet,
	sheetRepository,
} from "../../test/fixtures";
import {
	CloseEvaluationPeriodInteractor,
	type CloseEvaluationPeriodResponse,
	describeCloseEvaluationPeriodError,
} from "./CloseEvaluationPeriodInteractor";
import {
	DeleteEvaluationPeriodInteractor,
	describeDeleteEvaluationPeriodError,
} from "./DeleteEvaluationPeriodInteractor";
import {
	describeSaveEvaluationPeriodError,
	type EvaluationPeriodChangeResponse,
	SaveEvaluationPeriodInteractor,
} from "./SaveEvaluationPeriodInteractor";
import {
	describeStartEvaluationPeriodError,
	StartEvaluationPeriodInteractor,
	type StartEvaluationPeriodResponse,
} from "./StartEvaluationPeriodInteractor";
import { UpdateEvaluationStatusInteractor } from "./UpdateEvaluationStatusInteractor";
import { UpdateMilestoneInteractor } from "./UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./UpdateOverallCommentInteractor";
import { UpsertCommonEvaluationInteractor } from "./UpsertCommonEvaluationInteractor";

// 期間は 1: 前期(締め済み) / 2: 今期(実施中) / 3: 来期(まだ始めていない)
function setup(role: string | null = "Admin") {
	const periods = periodRepository();
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(role ? profile(role, 9) : null);
	return { periods, employees };
}
const nextTerm = { termName: "次期", startDate: "2028-04-01", endDate: "2029-03-31" };
/** 保存した計画を、比べやすい素の値にする。 */
const plain = (plan: EvaluationPeriodPlan) => ({
	periodName: plan.periodName,
	termName: plan.term.toString(),
	division: plan.part.division.toString(),
	part: plan.part.number,
	startDate: plan.range.start.toString(),
	endDate: plan.range.end.toString(),
	allowUnfinalizedClose: plan.allowUnfinalizedClose,
});
const writes = (periods: ReturnType<typeof periodRepository>) => [
	periods.create,
	periods.update,
	periods.delete,
	periods.activate,
	periods.close,
];

// 業務のきまり: 評価期間は「締める」と「開始する」を分けて行う。締めると次の評価期間は準備中になり、
// 管理者が等級の変更などを済ませてから、準備中の評価期間を開始する。
describe("closing an evaluation period", () => {
	const close = async (context: ReturnType<typeof setup>, periodId: number, confirmed: boolean) => {
		const out = output<CloseEvaluationPeriodResponse>();
		const result = await new CloseEvaluationPeriodInteractor(
			context.periods,
			context.employees,
		).execute({ periodId, confirmed }, out);
		if (!result.ok) {
			return { status: "rejected", message: describeCloseEvaluationPeriodError(result.error) };
		}
		return out.present.mock.lastCall?.[0];
	};

	it("first reports what closing would do, then closes on confirmation and leaves the next one preparing", async () => {
		const context = setup();
		expect(await close(context, 2, false)).toEqual({
			status: "ready",
			closing: expect.objectContaining({ id: 2, periodName: "今期" }),
			preparing: expect.objectContaining({ id: 3, periodName: "来期", state: "preparing" }),
			finalizedSheets: 4,
			unfinishedSheets: 0,
		});
		expect(context.periods.close).not.toHaveBeenCalled();

		expect(await close(context, 2, true)).toEqual({
			status: "closed",
			message:
				"「今期」を締めました。「来期」は準備中です。等級の変更などを済ませてから開始してください。",
		});
		expect(context.periods.close).toHaveBeenCalledExactlyOnceWith(2);
		// 締めても、次の評価期間は開始しない
		expect(context.periods.activate).not.toHaveBeenCalled();
	});

	it.each([false, true])(
		"refuses while the period still has unfinalized sheets (confirmed: %s)",
		async (confirmed) => {
			const context = setup();
			context.periods.countSheetsByStatus.mockResolvedValue(
				SheetCountsByStatus.from({ draft: 2, first_evaluated: 1, finalized: 7 }),
			);
			expect(await close(context, 2, confirmed)).toEqual({
				status: "rejected",
				message:
					"「今期」に未確定の評価シートが 3 件あります（下書き 2 件・二次評価待ち 1 件）。すべての評価を確定してから締めてください。評価を確定せずに締めるには、この期間を編集して「評価が確定していなくても締められる」をオンにしてください。",
			});
			expect(context.periods.countSheetsByStatus).toHaveBeenCalledWith(2);
			expect(context.periods.close).not.toHaveBeenCalled();
		},
	);

	it("closes with unfinalized sheets left when the Admin allowed it for the period", async () => {
		const context = setup();
		const [previous, , next] = await context.periods.findDistinctPeriods();
		context.periods.findDistinctPeriods.mockResolvedValue([
			previous,
			EvaluationPeriod.restore({
				id: 2,
				termName: "今期",
				startDate: "2026-04-01",
				endDate: "2027-03-31",
				isActive: true,
				allowUnfinalizedClose: true,
			}),
			next,
		]);
		context.periods.countSheetsByStatus.mockResolvedValue(
			SheetCountsByStatus.from({ draft: 2, submitted: 1, finalized: 7 }),
		);
		expect(await close(context, 2, false)).toMatchObject({
			status: "ready",
			finalizedSheets: 7,
			unfinishedSheets: 3,
		});
		expect(await close(context, 2, true)).toMatchObject({ status: "closed" });
		expect(context.periods.close).toHaveBeenCalledExactlyOnceWith(2);
	});

	it("refuses a period that is no longer the one in progress, so a stale screen closes nothing", async () => {
		const context = setup();
		for (const [periodId, name] of [
			[3, "来期"],
			[1, "前期"],
		] as const) {
			expect(await close(context, periodId, true)).toEqual({
				status: "rejected",
				message: `「${name}」は実施中ではないため、締められません。画面を開き直してください。`,
			});
		}
		expect(await close(context, 999, true)).toEqual({
			status: "rejected",
			message: "評価期間が見つかりませんでした。",
		});
		expect(context.periods.countSheetsByStatus).not.toHaveBeenCalled();
		expect(context.periods.close).not.toHaveBeenCalled();
	});

	it("says when there is no period to prepare next", async () => {
		const context = setup();
		const [previous, current] = await context.periods.findDistinctPeriods();
		context.periods.findDistinctPeriods.mockResolvedValue([previous, current]);
		expect(await close(context, 2, false)).toMatchObject({ status: "ready", preparing: null });
		expect(await close(context, 2, true)).toEqual({
			status: "closed",
			message:
				"「今期」を締めました。次に開始する評価期間はまだありません。評価期間を追加してから開始してください。",
		});
	});

	it("reports a failure to read, or a close the database refused, without closing", async () => {
		const context = setup();
		const controller = new EvaluationPeriodController(
			context.periods,
			new SaveEvaluationPeriodInteractor(context.periods, context.employees),
			new DeleteEvaluationPeriodInteractor(context.periods, context.employees),
			new CloseEvaluationPeriodInteractor(context.periods, context.employees),
			new StartEvaluationPeriodInteractor(context.periods, context.employees),
		);
		context.periods.countSheetsByStatus.mockRejectedValueOnce(new Error("network"));
		expect(await controller.close(2, true)).toEqual({
			status: "rejected",
			message: "評価期間を締められませんでした。",
		});
		context.periods.findDistinctPeriods.mockRejectedValueOnce(new Error("network"));
		expect(await controller.close(2, true)).toMatchObject({ status: "rejected" });
		expect(context.periods.close).not.toHaveBeenCalled();
		context.periods.close.mockRejectedValueOnce(new Error("network"));
		expect(await controller.close(2, true)).toMatchObject({ status: "rejected" });
		context.periods.close.mockResolvedValueOnce(false);
		expect(await controller.close(2, true)).toEqual({
			status: "rejected",
			message: "評価期間を締められませんでした。",
		});
		expect(context.periods.activate).not.toHaveBeenCalled();
	});

	it.each(["Reviewer", "Employee", null])("is for an Admin only (%s)", async (role) => {
		const context = setup(role);
		expect(await close(context, 2, true)).toEqual({
			status: "rejected",
			message: "評価期間を締められるのは Admin のみです。",
		});
		expect(context.periods.close).not.toHaveBeenCalled();
		expect(context.periods.countSheetsByStatus).not.toHaveBeenCalled();
	});
});

describe("starting an evaluation period", () => {
	const start = async (context: ReturnType<typeof setup>, periodId: number, confirmed: boolean) => {
		const out = output<StartEvaluationPeriodResponse>();
		const result = await new StartEvaluationPeriodInteractor(
			context.periods,
			context.employees,
		).execute({ periodId, confirmed }, out);
		if (!result.ok) {
			return { status: "rejected", message: describeStartEvaluationPeriodError(result.error) };
		}
		return out.present.mock.lastCall?.[0];
	};
	/** 今期を締めた後(来期が準備中、その先に再来期)。 */
	const afterClosing = (context: ReturnType<typeof setup>) => {
		const period = (id: number, termName: string, startDate: string, isClosed = false) =>
			EvaluationPeriod.restore({
				id,
				termName,
				startDate,
				endDate: `${Number(startDate.slice(0, 4)) + 1}-03-31`,
				isActive: false,
				isClosed,
			});
		context.periods.findDistinctPeriods.mockResolvedValue([
			period(1, "前期", "2025-04-01", true),
			period(2, "今期", "2026-04-01", true),
			period(3, "来期", "2027-04-01"),
			period(4, "再来期", "2028-04-01"),
		]);
	};

	it("starts the preparing period after confirmation", async () => {
		const context = setup();
		afterClosing(context);
		expect(await start(context, 3, false)).toEqual({
			status: "ready",
			next: expect.objectContaining({ id: 3, periodName: "来期", state: "preparing" }),
		});
		expect(context.periods.activate).not.toHaveBeenCalled();
		expect(await start(context, 3, true)).toEqual({
			status: "started",
			message: "「来期」を開始しました。",
		});
		expect(context.periods.activate).toHaveBeenCalledExactlyOnceWith(3);
		// 開始は締めない
		expect(context.periods.close).not.toHaveBeenCalled();
	});

	it("refuses to start while a period is still in progress", async () => {
		const context = setup();
		expect(await start(context, 3, true)).toEqual({
			status: "rejected",
			message: "「今期」を締めてから、次の評価期間を開始してください。",
		});
		expect(await start(context, 2, true)).toEqual({
			status: "rejected",
			message: "「今期」は既に実施中です。",
		});
		expect(context.periods.activate).not.toHaveBeenCalled();
	});

	it("starts only the preparing period, never a later one, a closed one or an unknown one", async () => {
		const context = setup();
		afterClosing(context);
		expect(await start(context, 4, true)).toEqual({
			status: "rejected",
			message: "次に開始できるのは、準備中の「来期」です。「再来期」はその後に開始してください。",
		});
		expect(await start(context, 2, true)).toEqual({
			status: "rejected",
			message: "「今期」は締め済みのため、もう一度開始することはできません。",
		});
		expect(await start(context, 999, true)).toEqual({
			status: "rejected",
			message: "評価期間が見つかりません。",
		});
		expect(context.periods.activate).not.toHaveBeenCalled();
	});

	it("starts the very first period, when none has been in progress yet", async () => {
		const context = setup();
		context.periods.findDistinctPeriods.mockResolvedValue([
			EvaluationPeriod.restore({
				id: 3,
				termName: "来期",
				startDate: "2027-04-01",
				endDate: "2028-03-31",
				isActive: false,
			}),
		]);
		expect(await start(context, 3, false)).toMatchObject({ status: "ready" });
		expect(await start(context, 3, true)).toMatchObject({ status: "started" });
		expect(context.periods.activate).toHaveBeenCalledExactlyOnceWith(3);
	});

	it("reports a start the database refused or that failed on the way", async () => {
		const context = setup();
		afterClosing(context);
		const controller = new EvaluationPeriodController(
			context.periods,
			new SaveEvaluationPeriodInteractor(context.periods, context.employees),
			new DeleteEvaluationPeriodInteractor(context.periods, context.employees),
			new CloseEvaluationPeriodInteractor(context.periods, context.employees),
			new StartEvaluationPeriodInteractor(context.periods, context.employees),
		);
		context.periods.activate.mockResolvedValueOnce(false);
		expect(await controller.start(3, true)).toEqual({
			status: "rejected",
			message: "評価期間を開始できませんでした。",
		});
		context.periods.activate.mockRejectedValueOnce(new Error("network"));
		expect(await controller.start(3, true)).toEqual({
			status: "rejected",
			message: "評価期間を開始できませんでした。",
		});
	});

	it.each(["Reviewer", "Employee", null])("is for an Admin only (%s)", async (role) => {
		const context = setup(role);
		afterClosing(context);
		expect(await start(context, 3, true)).toEqual({
			status: "rejected",
			message: "評価期間を開始できるのは Admin のみです。",
		});
		expect(context.periods.activate).not.toHaveBeenCalled();
	});
});

describe("adding, editing and deleting evaluation periods", () => {
	const run = async (
		context: ReturnType<typeof setup>,
		request: Parameters<SaveEvaluationPeriodInteractor["execute"]>[0],
	) => {
		const out = output<EvaluationPeriodChangeResponse>();
		const result = await new SaveEvaluationPeriodInteractor(
			context.periods,
			context.employees,
		).execute(request, out);
		if (!result.ok) {
			return { success: false, message: describeSaveEvaluationPeriodError(result.error) };
		}
		return out.present.mock.calls[0][0];
	};
	const remove = async (context: ReturnType<typeof setup>, periodId: number) => {
		const out = output<EvaluationPeriodChangeResponse>();
		const result = await new DeleteEvaluationPeriodInteractor(
			context.periods,
			context.employees,
		).execute({ periodId }, out);
		if (!result.ok) {
			return { success: false, message: describeDeleteEvaluationPeriodError(result.error) };
		}
		return out.present.mock.calls[0][0];
	};

	it("adds a period, and changes the term name and dates of an existing one", async () => {
		const context = setup();
		expect(await run(context, { ...nextTerm, termName: " 次期 " })).toMatchObject({
			success: true,
		});
		expect(context.periods.create.mock.calls[0][0].map(plain)).toEqual([
			{
				periodName: "次期",
				termName: "次期",
				division: "full",
				part: 1,
				startDate: "2028-04-01",
				endDate: "2029-03-31",
				allowUnfinalizedClose: false,
			},
		]);
		// 自分自身の名前は重複として扱わない
		await expect(
			await run(context, {
				...nextTerm,
				periodId: 3,
				termName: "来期",
				allowUnfinalizedClose: true,
			}),
		).toEqual({ success: true, message: "評価期間「来期」を保存しました。" });
		expect(context.periods.update).toHaveBeenCalledOnce();
		const [id, plan] = context.periods.update.mock.calls[0];
		expect([id, plain(plan)]).toEqual([
			3,
			{
				periodName: "来期",
				termName: "来期",
				division: "full",
				part: 1,
				startDate: "2028-04-01",
				endDate: "2029-03-31",
				allowUnfinalizedClose: true,
			},
		]);
	});

	it("divides a term into independent half-year periods, named and dated without a calendar", async () => {
		const context = setup();
		expect(
			await run(context, {
				termName: "26期",
				startDate: "2026-03-23",
				endDate: "2027-03-22",
				division: "half",
				allowUnfinalizedClose: true,
			}),
		).toEqual({
			success: true,
			message:
				"評価期間「26期 上期」「26期 下期」を追加しました。開始するには、一覧の「この期間を開始する」を押してください。",
		});
		expect(context.periods.create.mock.calls[0][0].map(plain)).toEqual([
			{
				periodName: "26期 上期",
				termName: "26期",
				division: "half",
				part: 1,
				startDate: "2026-03-23",
				endDate: "2026-09-22",
				allowUnfinalizedClose: true,
			},
			{
				periodName: "26期 下期",
				termName: "26期",
				division: "half",
				part: 2,
				startDate: "2026-09-23",
				endDate: "2027-03-22",
				allowUnfinalizedClose: true,
			},
		]);
	});

	it("keeps the division when renaming a divided period", async () => {
		const context = setup();
		context.periods.findDistinctPeriods.mockResolvedValue([
			EvaluationPeriod.restore({
				id: 7,
				termName: "26期",
				division: "half",
				part: 2,
				startDate: "2026-09-23",
				endDate: "2027-03-22",
				isActive: false,
			}),
		]);
		expect(
			await run(context, {
				periodId: 7,
				termName: "第26期",
				startDate: "2026-10-01",
				endDate: "2027-03-31",
				// 変更では区切り方は変えられない
				division: "quarter",
			}),
		).toEqual({ success: true, message: "評価期間「第26期 下期」を保存しました。" });
		expect(plain(context.periods.update.mock.calls[0][1])).toMatchObject({
			periodName: "第26期 下期",
			division: "half",
			part: 2,
		});
	});

	it("rejects a division that leaves no room or reuses a name, without saving", async () => {
		const context = setup();
		const short = { termName: "短期", startDate: "2028-04-01", endDate: "2028-08-31" };
		expect(await run(context, { ...short, division: "half" })).toEqual({
			success: false,
			message: "半期(上期・下期)に分けるには期間が短すぎます。開始日と終了日を確かめてください。",
		});
		context.periods.findDistinctPeriods.mockResolvedValue([
			EvaluationPeriod.restore({
				id: 5,
				termName: "29期",
				division: "half",
				part: 2,
				startDate: "2029-10-01",
				endDate: "2030-03-31",
				isActive: false,
			}),
		]);
		expect(
			await run(context, {
				termName: "29期",
				startDate: "2029-04-01",
				endDate: "2030-03-31",
				division: "half",
			}),
		).toEqual({ success: false, message: "「29期 下期」という評価期間は既にあります。" });
		expect(context.periods.create).not.toHaveBeenCalled();
	});

	// 追加するときも、既にある評価期間(来期 3)を変えるときも、同じ入力の誤りで止める
	it.each(
		[
			["a blank name", { termName: "  " }, "期の名前を入力してください。"],
			["a name already used", { termName: "今期" }, "「今期」という評価期間は既にあります。"],
			["a missing start date", { startDate: "" }, "開始日と終了日を入力してください。"],
			["a missing end date", { endDate: "" }, "開始日と終了日を入力してください。"],
			[
				"a start date that does not exist",
				{ startDate: "2028-02-30" },
				"日付は実在する日を YYYY-MM-DD で入力してください。",
			],
			[
				"an end date that does not exist",
				{ endDate: "2029-02-30" },
				"日付は実在する日を YYYY-MM-DD で入力してください。",
			],
			[
				"an end before the start",
				{ endDate: "2028-03-31" },
				"終了日は開始日以降の日付にしてください。",
			],
		].flatMap(([label, override, message]) =>
			[undefined, 3].map((periodId) => [label, periodId, override, message] as const),
		),
	)("rejects %s without saving (period %s)", async (_label, periodId, override, message) => {
		const context = setup();
		expect(await run(context, { ...nextTerm, periodId, ...(override as object) })).toEqual({
			success: false,
			message,
		});
		for (const write of writes(context.periods)) {
			expect(write).not.toHaveBeenCalled();
		}
	});

	it.each([
		[
			"an unknown division",
			{ division: "monthly" },
			"評価期間の区切りは、通年・半期・四半期から選んでください。",
		],
		["an unknown period", { periodId: 999 }, "評価期間が見つかりませんでした。"],
	])("rejects %s without saving", async (_label, override, message) => {
		const context = setup();
		expect(await run(context, { ...nextTerm, ...override })).toEqual({ success: false, message });
		for (const write of writes(context.periods)) {
			expect(write).not.toHaveBeenCalled();
		}
	});

	it("deletes only a period that is not in progress and has no sheets", async () => {
		const context = setup();
		expect(await remove(context, 3)).toEqual({
			success: true,
			message: "評価期間「来期」を削除しました。",
		});
		expect(context.periods.delete).toHaveBeenCalledExactlyOnceWith(3);
		expect(await remove(context, 2)).toEqual({
			success: false,
			message: "実施中の評価期間は削除できません。",
		});
		expect(await remove(context, 1)).toEqual({
			success: false,
			message: "「前期」には評価シートが 4 件あるため、削除できません。",
		});
		expect(await remove(context, 999)).toMatchObject({ success: false });
		expect(context.periods.delete).toHaveBeenCalledTimes(1);
	});

	it.each(["Reviewer", "Employee", null])("is for an Admin only (%s)", async (role) => {
		const context = setup(role);
		expect(await run(context, nextTerm)).toMatchObject({ success: false });
		expect(await run(context, { ...nextTerm, periodId: 3 })).toMatchObject({ success: false });
		expect(await remove(context, 3)).toMatchObject({ success: false });
		for (const write of writes(context.periods)) {
			expect(write).not.toHaveBeenCalled();
		}
	});

	it("reports a save or deletion that failed on the way, without crashing", async () => {
		const context = setup();
		const controller = new EvaluationPeriodController(
			context.periods,
			new SaveEvaluationPeriodInteractor(context.periods, context.employees),
			new DeleteEvaluationPeriodInteractor(context.periods, context.employees),
			new CloseEvaluationPeriodInteractor(context.periods, context.employees),
			new StartEvaluationPeriodInteractor(context.periods, context.employees),
		);
		context.periods.create.mockRejectedValueOnce(new Error("network"));
		expect(await controller.save(nextTerm)).toEqual({
			success: false,
			message: "評価期間を保存できませんでした。",
		});
		context.periods.delete.mockRejectedValueOnce(new Error("network"));
		expect(await controller.remove(3)).toEqual({
			success: false,
			message: "評価期間を削除できませんでした。",
		});
		context.periods.findDistinctPeriods.mockRejectedValueOnce(new Error("network"));
		await expect(controller.load()).rejects.toThrow("network");
	});

	it("refuses to delete a closed period that has sheets, but deletes an empty one", async () => {
		const context = setup();
		expect(await remove(context, 1)).toEqual({
			success: false,
			message: "「前期」には評価シートが 4 件あるため、削除できません。",
		});
		context.periods.countSheetsByStatus.mockResolvedValueOnce(SheetCountsByStatus.NONE);
		expect(await remove(context, 1)).toMatchObject({ success: true });
	});

	it("reports a save or deletion the database refused", async () => {
		const context = setup();
		context.periods.create.mockResolvedValue(false);
		context.periods.delete.mockResolvedValue(false);
		expect(await run(context, nextTerm)).toMatchObject({ success: false });
		expect(await remove(context, 3)).toMatchObject({ success: false });
	});
});

describe("sheets of a closed period", () => {
	// 状態だけなら編集できる段階のシートでも、締めた期間では誰も変更できない
	const repositories = (status: EvaluationStatus) => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(sheet(status, undefined, true));
		const milestones = milestoneRepository();
		const common = commonRepository();
		return {
			sheets,
			milestones,
			common,
		};
	};

	it("rejects every status change, whoever asks", async () => {
		const attempts: [EvaluationStatus, EvaluationStatus, number][] = [
			[EvaluationStatus.DRAFT, EvaluationStatus.SUBMITTED, 1],
			[EvaluationStatus.SUBMITTED, EvaluationStatus.DRAFT, 1],
			[EvaluationStatus.SUBMITTED, EvaluationStatus.FIRST_EVALUATED, 2],
			[EvaluationStatus.FIRST_EVALUATED, EvaluationStatus.FINALIZED, 3],
		];
		for (const [current, next, employeeId] of attempts) {
			const { sheets } = repositories(current);
			await expect(
				new UpdateEvaluationStatusInteractor(sheets, employeeRepository()).execute(
					{ sheetId: 100, status: next, currentEmployeeId: employeeId },
					output<never>(),
				),
			).resolves.toMatchObject({ ok: false, error: { kind: "periodClosed" } });
			expect(sheets.updateStatus).not.toHaveBeenCalled();
		}
	});

	it("rejects goals, scores, common evaluation and comments before any write", async () => {
		const draft = repositories(EvaluationStatus.DRAFT);
		await expect(
			new UpdateMilestoneInteractor(draft.milestones, draft.sheets).execute(
				{
					action: "text",
					sheetId: 100,
					currentEmployeeId: 1,
					milestoneId: 11,
					challengeGoal: "書き換え",
				},
				output<never>(),
			),
		).resolves.toMatchObject({ ok: false, error: { kind: "periodClosed" } });

		const submitted = repositories(EvaluationStatus.SUBMITTED);
		await expect(
			new UpdateMilestoneInteractor(submitted.milestones, submitted.sheets).execute(
				{ action: "score", sheetId: 100, currentEmployeeId: 2, milestoneId: 11, firstScore: 4 },
				output<never>(),
			),
		).resolves.toMatchObject({ ok: false, error: { kind: "periodClosed" } });
		await expect(
			new UpsertCommonEvaluationInteractor(submitted.sheets, submitted.common).execute(
				{
					sheetId: 100,
					currentEmployeeId: 2,
					results: [{ id: 21, itemId: 31, firstComment: "", firstScore: 4, secondScore: 0 }],
				},
				output<never>(),
			),
		).resolves.toMatchObject({ ok: false, error: { kind: "periodClosed" } });
		await expect(
			new UpdateOverallCommentInteractor(submitted.sheets, employeeRepository()).execute(
				{ sheetId: 100, target: "first", comment: "書き換え", currentEmployeeId: 2 },
				output<never>(),
			),
		).resolves.toMatchObject({ ok: false, error: { kind: "periodClosed" } });

		for (const { sheets, milestones, common } of [draft, submitted]) {
			for (const write of [
				milestones.updateText,
				milestones.upsertText,
				milestones.updateScore,
				common.upsertResults,
				sheets.updateOverallComment,
				sheets.updateStatus,
			]) {
				expect(write).not.toHaveBeenCalled();
			}
		}
	});
});
