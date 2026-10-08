import { describe, expect, it } from "vitest";
import { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
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
} from "./CloseEvaluationPeriodInteractor";
import { DeleteEvaluationPeriodInteractor } from "./DeleteEvaluationPeriodInteractor";
import {
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
const nextTerm = { periodName: "次期", startDate: "2028-04-01", endDate: "2029-03-31" };
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
		await new CloseEvaluationPeriodInteractor(context.periods, context.employees).execute(
			{ nextPeriodId, confirmed },
			out,
		);
		return out.present.mock.calls[0][0];
	};

	it("first reports what would be closed without changing anything, then switches on confirmation", async () => {
		const context = setup();
		expect(await close(context, 3, false)).toEqual({
			status: "ready",
			closing: expect.objectContaining({ id: 2, periodName: "今期" }),
			next: expect.objectContaining({ id: 3, periodName: "来期" }),
			finalizedSheets: 4,
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
			context.periods.countSheetsByStatus.mockResolvedValue({
				draft: 2,
				first_evaluated: 1,
				finalized: 7,
			});
			expect(await close(context, 3, confirmed)).toEqual({
				status: "rejected",
				message:
					"「今期」に未確定の評価シートが 3 件あります（下書き 2 件・一次評価済み 1 件）。すべての評価を確定してから締めてください。",
			});
			expect(context.periods.countSheetsByStatus).toHaveBeenCalledWith(2);
			expect(context.periods.activate).not.toHaveBeenCalled();
		},
	);

	it("lets a mistaken closing be undone by starting the previous period again", async () => {
		const context = setup();
		expect(await close(context, 1, true)).toEqual({
			status: "closed",
			message: "「今期」を締め、「前期」を開始しました。",
		});
		expect(context.periods.activate).toHaveBeenCalledWith(1);
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
});

describe("adding, editing and deleting evaluation periods", () => {
	const run = async (
		context: ReturnType<typeof setup>,
		request: Parameters<SaveEvaluationPeriodInteractor["execute"]>[0],
	) => {
		const out = output<EvaluationPeriodChangeResponse>();
		await new SaveEvaluationPeriodInteractor(context.periods, context.employees).execute(
			request,
			out,
		);
		return out.present.mock.calls[0][0];
	};
	const remove = async (context: ReturnType<typeof setup>, periodId: number) => {
		const out = output<EvaluationPeriodChangeResponse>();
		await new DeleteEvaluationPeriodInteractor(context.periods, context.employees).execute(
			{ periodId },
			out,
		);
		return out.present.mock.calls[0][0];
	};

	it("adds a period, and changes the name and dates of an existing one", async () => {
		const context = setup();
		expect(await run(context, { ...nextTerm, periodName: " 次期 " })).toMatchObject({
			success: true,
		});
		expect(context.periods.create).toHaveBeenCalledWith(nextTerm);
		// 自分自身の名前は重複として扱わない
		expect(await run(context, { ...nextTerm, periodId: 3, periodName: "来期" })).toMatchObject({
			success: true,
		});
		expect(context.periods.update).toHaveBeenCalledWith(3, { ...nextTerm, periodName: "来期" });
	});

	it.each([
		["a blank name", { periodName: "  " }],
		["a name already used", { periodName: "今期" }],
		["a missing date", { startDate: "" }],
		["a date that does not exist", { endDate: "2029-02-30" }],
		["an end before the start", { endDate: "2028-03-31" }],
		["an unknown period", { periodId: 999 }],
	])("rejects %s without saving", async (_label, override) => {
		const context = setup();
		expect(await run(context, { ...nextTerm, ...override })).toMatchObject({ success: false });
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

	it("reports a save or deletion the database refused", async () => {
		const context = setup();
		context.periods.create.mockResolvedValue(false);
		context.periods.delete.mockResolvedValue(false);
		expect(await run(context, nextTerm)).toMatchObject({ success: false });
		expect(await remove(context, 3)).toMatchObject({ success: false });
	});
});

describe("sheets of a closed period", () => {
	const closedMessage = "この評価期間は締められているため";
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
			scores: new EvaluationScoreUpdateService(sheets, milestones, common),
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
			).rejects.toThrow(closedMessage);
			expect(sheets.updateStatus).not.toHaveBeenCalled();
			expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
		}
	});

	it("rejects goals, scores, common evaluation and comments before any write", async () => {
		const draft = repositories(EvaluationStatus.DRAFT);
		await expect(
			new UpdateMilestoneInteractor(draft.milestones, draft.sheets, draft.scores).execute(
				{ sheetId: 100, currentEmployeeId: 1, milestoneId: 11, challengeGoal: "書き換え" },
				output<never>(),
			),
		).rejects.toThrow(closedMessage);

		const submitted = repositories(EvaluationStatus.SUBMITTED);
		await expect(
			new UpdateMilestoneInteractor(
				submitted.milestones,
				submitted.sheets,
				submitted.scores,
			).execute(
				{ sheetId: 100, currentEmployeeId: 2, milestoneId: 11, firstScore: 4 },
				output<never>(),
			),
		).rejects.toThrow(closedMessage);
		await expect(
			new UpsertCommonEvaluationInteractor(submitted.sheets, submitted.scores).execute(
				{
					sheetId: 100,
					currentEmployeeId: 2,
					results: [{ id: 21, itemId: 31, firstComment: "", firstScore: 4, secondScore: 0 }],
				},
				output<never>(),
			),
		).rejects.toThrow(closedMessage);
		await expect(
			new UpdateOverallCommentInteractor(submitted.sheets, employeeRepository()).execute(
				{ sheetId: 100, target: "first", comment: "書き換え", currentEmployeeId: 2 },
				output<never>(),
			),
		).rejects.toThrow(closedMessage);

		for (const { sheets, milestones, common } of [draft, submitted]) {
			for (const write of [
				milestones.updateText,
				milestones.upsertText,
				milestones.updateScore,
				common.upsertResults,
				sheets.updateOverallComment,
				sheets.updateScoreTotals,
				sheets.updateStatus,
			]) {
				expect(write).not.toHaveBeenCalled();
			}
		}
	});
});
