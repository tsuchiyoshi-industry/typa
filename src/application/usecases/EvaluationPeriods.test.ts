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
];

describe("closing an evaluation period", () => {
	const close = async (
		context: ReturnType<typeof setup>,
		nextPeriodId: number,
		confirmed: boolean,
	) => {
		const out = output<CloseEvaluationPeriodResponse>();
		const result = await new CloseEvaluationPeriodInteractor(
			context.periods,
			context.employees,
		).execute({ nextPeriodId, confirmed }, out);
		if (!result.ok) {
			return { status: "rejected", message: describeCloseEvaluationPeriodError(result.error) };
		}
		return out.present.mock.calls[0][0];
	};

	it("first reports what would be closed without changing anything, then switches on confirmation", async () => {
		const context = setup();
		expect(await close(context, 3, false)).toEqual({
			status: "ready",
			closing: expect.objectContaining({ id: 2, periodName: "今期" }),
			next: expect.objectContaining({ id: 3, periodName: "来期" }),
			finalizedSheets: 4,
			unfinishedSheets: 0,
		});
		expect(context.periods.activate).not.toHaveBeenCalled();

		expect(await close(context, 3, true)).toEqual({
			status: "closed",
			message: "「今期」を締め、「来期」を開始しました。",
		});
		// 実施中の期間は、次の期間を実施中にするのと同時に締められる(1回の操作)
		expect(context.periods.activate).toHaveBeenCalledExactlyOnceWith(3);
	});

	it.each([false, true])(
		"refuses while the period still has unfinalized sheets (confirmed: %s)",
		async (confirmed) => {
			const context = setup();
			context.periods.countSheetsByStatus.mockResolvedValue(
				SheetCountsByStatus.from({ draft: 2, first_evaluated: 1, finalized: 7 }),
			);
			expect(await close(context, 3, confirmed)).toEqual({
				status: "rejected",
				message:
					"「今期」に未確定の評価シートが 3 件あります（下書き 2 件・二次評価待ち 1 件）。すべての評価を確定してから締めてください。評価を確定せずに締めるには、この期間を編集して「評価が確定していなくても締められる」をオンにしてください。",
			});
			expect(context.periods.countSheetsByStatus).toHaveBeenCalledWith(2);
			expect(context.periods.activate).not.toHaveBeenCalled();
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
		expect(await close(context, 3, false)).toMatchObject({
			status: "ready",
			finalizedSheets: 7,
			unfinishedSheets: 3,
		});
		expect(await close(context, 3, true)).toMatchObject({ status: "closed" });
		expect(context.periods.activate).toHaveBeenCalledExactlyOnceWith(3);
	});

	it("never starts a closed period again, so a closing cannot be undone by reopening", async () => {
		const context = setup();
		expect(await close(context, 1, false)).toEqual({
			status: "rejected",
			message: "「前期」は締め済みのため、もう一度開始することはできません。",
		});
		expect(await close(context, 1, true)).toMatchObject({ status: "rejected" });
		expect(context.periods.activate).not.toHaveBeenCalled();
	});

	it("reports a failure to read the sheets or to switch, without switching", async () => {
		const context = setup();
		const controller = new EvaluationPeriodController(
			context.periods,
			new SaveEvaluationPeriodInteractor(context.periods, context.employees),
			new DeleteEvaluationPeriodInteractor(context.periods, context.employees),
			new CloseEvaluationPeriodInteractor(context.periods, context.employees),
		);
		context.periods.countSheetsByStatus.mockRejectedValueOnce(new Error("network"));
		expect(await controller.close(3, true)).toEqual({
			status: "rejected",
			message: "評価期間を切り替えられませんでした。",
		});
		context.periods.activate.mockRejectedValueOnce(new Error("network"));
		expect(await controller.close(3, true)).toMatchObject({ status: "rejected" });
		// 読み込みに失敗した評価期間は、開始の対象にしない
		context.periods.findDistinctPeriods.mockRejectedValueOnce(new Error("network"));
		expect(await controller.close(3, true)).toMatchObject({ status: "rejected" });
		expect(context.periods.activate).toHaveBeenCalledOnce();
	});

	it.each(["Reviewer", "Employee", null])("is for an Admin only (%s)", async (role) => {
		const context = setup(role);
		expect(await close(context, 3, true)).toMatchObject({ status: "rejected" });
		expect(context.periods.activate).not.toHaveBeenCalled();
		expect(context.periods.countSheetsByStatus).not.toHaveBeenCalled();
	});

	it("rejects an unknown period, the period already in progress, and a switch the database refused", async () => {
		const context = setup();
		expect(await close(context, 999, true)).toMatchObject({ status: "rejected" });
		expect(await close(context, 2, true)).toEqual({
			status: "rejected",
			message: "「今期」は既に実施中です。",
		});
		expect(context.periods.activate).not.toHaveBeenCalled();
		context.periods.activate.mockResolvedValue(false);
		expect(await close(context, 3, true)).toMatchObject({ status: "rejected" });
	});

	it("starts the very first period without closing anything, when none is in progress yet", async () => {
		const context = setup();
		const first = EvaluationPeriod.restore({
			id: 3,
			termName: "来期",
			startDate: "2027-04-01",
			endDate: "2028-03-31",
			isActive: false,
		});
		context.periods.findDistinctPeriods.mockResolvedValue([first]);
		expect(await close(context, 3, false)).toEqual({
			status: "ready",
			closing: null,
			next: expect.objectContaining({ id: 3 }),
			finalizedSheets: 0,
			unfinishedSheets: 0,
		});
		// 締める期間が無いので、シートを数えに行かない
		expect(context.periods.countSheetsByStatus).not.toHaveBeenCalled();
		expect(await close(context, 3, true)).toEqual({
			status: "closed",
			message: "「来期」を開始しました。",
		});
		expect(context.periods.activate).toHaveBeenCalledExactlyOnceWith(3);
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
