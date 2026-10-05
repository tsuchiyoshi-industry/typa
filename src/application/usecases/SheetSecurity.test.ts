import { describe, expect, it, vi } from "vitest";
import { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	commonRepository,
	employeeRepository,
	milestoneRepository,
	output,
	sheet,
	sheetRepository,
} from "../../test/fixtures";
import { FetchEvaluationSheetInteractor } from "./FetchEvaluationSheetInteractor";
import { LoadCommonEvaluationInteractor } from "./LoadCommonEvaluationInteractor";
import { UpdateEvaluationStatusInteractor } from "./UpdateEvaluationStatusInteractor";
import { UpdateFinalEvaluationRankInteractor } from "./UpdateFinalEvaluationRankInteractor";
import { UpdateMilestoneInteractor } from "./UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./UpdateOverallCommentInteractor";
import { UpsertCommonEvaluationInteractor } from "./UpsertCommonEvaluationInteractor";

function setup(status = EvaluationStatus.SUBMITTED) {
	const sheets = sheetRepository();
	sheets.findById.mockResolvedValue(sheet(status));
	const employees = employeeRepository();
	const milestones = milestoneRepository();
	const common = commonRepository();
	const scores = new EvaluationScoreUpdateService(sheets, milestones, common);
	return { sheets, employees, milestones, common, scores, out: output<never>() };
}

describe("sheet reading and confidentiality", () => {
	it.each([null, 4])("denies viewer %s without presenting personal data", async (id) => {
		const { sheets, employees, out } = setup();
		await expect(
			new FetchEvaluationSheetInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: id },
				out,
			),
		).rejects.toThrow("権限");
		expect(out.present).not.toHaveBeenCalled();
		expect(employees.findGradeName).not.toHaveBeenCalled();
	});
	it("returns an empty result for missing sheet", async () => {
		const { sheets, employees, out } = setup();
		sheets.findById.mockResolvedValue(null);
		await new FetchEvaluationSheetInteractor(sheets, employees).execute(
			{ sheetId: 100, currentEmployeeId: 1 },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({ subject: null, objectives: [] }),
		);
	});
	it.each([1, 2, 3])("redacts all restricted fields for role %s", async (id) => {
		const { sheets, employees } = setup();
		const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
		await new FetchEvaluationSheetInteractor(sheets, employees).execute(
			{ sheetId: 100, currentEmployeeId: id },
			out,
		);
		const dto = out.present.mock.calls[0][0];
		expect(dto.objectives[0].secondScore).toBe(id === 2 ? null : 4);
		expect(dto.objectiveScoreTotals.secondTotalScore).toBe(id === 2 ? null : 4);
		expect(dto.firstOverallComment).toBe(id === 1 ? "" : "一次総評");
		expect(dto.secondOverallComment).toBe(id === 3 ? "二次総評" : "");
		expect(dto.commonEvaluationScoreTotals.firstTotalScore).toBe(id === 1 ? null : 3);
		expect(dto.commonEvaluationScoreTotals.secondTotalScore).toBe(id === 3 ? 5 : null);
		expect(dto.allocatedScores.commonEvaluationSecondRate).toBe(id === 3 ? 100 : null);
		expect(dto.allocatedScores.totalEvaluationScore).toBe(id === 3 ? 100 : null);
		expect(dto.finalEvaluationRank?.displayText).toBe(id === 3 ? "A＋" : undefined);
	});
	it.each([1, 4])("does not query common evaluation for unauthorized role %s", async (id) => {
		const { sheets, common, out } = setup();
		await expect(
			new LoadCommonEvaluationInteractor(common, sheets).execute(
				{ sheetId: 100, gradeId: 99, currentEmployeeId: id },
				out,
			),
		).rejects.toThrow("権限");
		expect(common.findResultsBySheetId).not.toHaveBeenCalled();
	});
	it.each([2, 3])("uses subject grade and masks common secondary scores for %s", async (id) => {
		const { sheets, common } = setup();
		const out = output<import("./LoadCommonEvaluationInteractor").LoadCommonEvaluationResponse>();
		await new LoadCommonEvaluationInteractor(common, sheets).execute(
			{ sheetId: 100, gradeId: 99, currentEmployeeId: id },
			out,
		);
		expect(common.findResultsBySheetId).toHaveBeenCalledWith(100, 5);
		expect(out.present.mock.calls[0][0]).toMatchObject({
			totalSecondScore: id === 3 ? 5 : null,
			secondRate: id === 3 ? 100 : null,
			results: [expect.objectContaining({ secondScore: id === 3 ? 5 : null })],
		});
	});
});

describe("milestone updates validate before side effects", () => {
	it.each(["update", "upsert"])("partial text %s preserves omitted fields", async (mode) => {
		const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
		await new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
			{
				sheetId: 100,
				currentEmployeeId: 1,
				...(mode === "update" ? { milestoneId: 11 } : { goalNumber: 1 }),
				challengeGoal: "new",
			},
			out,
		);
		expect(mode === "update" ? milestones.updateText : milestones.upsertText).toHaveBeenCalledWith(
			...(mode === "update" ? [11, "new", "中間", "達成"] : [100, 1, "new", "中間", "達成"]),
		);
	});
	it.each(["text", "score"])("rejects a milestone from another sheet (%s)", async (kind) => {
		const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
		await expect(
			new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
				{
					sheetId: 100,
					currentEmployeeId: 1,
					milestoneId: 999,
					...(kind === "text" ? { challengeGoal: "attack" } : { firstScore: 4 }),
				},
				out,
			),
		).rejects.toThrow("属して");
		expect(milestones.updateText).not.toHaveBeenCalled();
		expect(milestones.updateScore).not.toHaveBeenCalled();
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it("rejects mixed authorized text and unauthorized score without partial write", async () => {
		const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
		await expect(
			new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
				{
					sheetId: 100,
					currentEmployeeId: 1,
					milestoneId: 11,
					challengeGoal: "changed",
					firstScore: 4,
				},
				out,
			),
		).rejects.toThrow("一次評価者");
		expect(milestones.updateText).not.toHaveBeenCalled();
	});
	it.each([-1, 5, 0.5, NaN, Infinity])("rejects score %s before persisting", async (firstScore) => {
		const { sheets, milestones, scores, out } = setup();
		await expect(
			new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
				{ sheetId: 100, currentEmployeeId: 2, milestoneId: 11, firstScore },
				out,
			),
		).rejects.toThrow("整数");
		expect(milestones.updateScore).not.toHaveBeenCalled();
	});
	it.each([0, -1, 1.5, NaN])("rejects invalid goal number %s", async (goalNumber) => {
		const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
		await expect(
			new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
				{ sheetId: 100, currentEmployeeId: 1, goalNumber, challengeGoal: "x" },
				out,
			),
		).rejects.toThrow("番号");
		expect(milestones.upsertText).not.toHaveBeenCalled();
	});
	it.each([EvaluationStatus.SUBMITTED, EvaluationStatus.FINALIZED])(
		"denies subject editing locked goal (%s)",
		async (status) => {
			const { sheets, milestones, scores, out } = setup(status);
			await expect(
				new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
					{ sheetId: 100, currentEmployeeId: 1, milestoneId: 11, challengeGoal: "x" },
					out,
				),
			).rejects.toThrow("目標");
			expect(milestones.updateText).not.toHaveBeenCalled();
		},
	);
	it.each([2, 3])(
		"writes only permitted evaluator score %s and recalculates totals",
		async (id) => {
			const { sheets, milestones, scores, out } = setup();
			await new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
				{
					sheetId: 100,
					currentEmployeeId: id,
					milestoneId: 11,
					...(id === 2 ? { firstScore: 2 } : { secondScore: 4 }),
				},
				out,
			);
			expect(milestones.updateScore).toHaveBeenCalledWith(
				11,
				id === 2 ? 2 : undefined,
				id === 3 ? 4 : undefined,
			);
			expect(sheets.updateScoreTotals).toHaveBeenCalledWith(
				100,
				expect.objectContaining({
					allocatedScores: expect.objectContaining({ totalEvaluationScore: 100 }),
				}),
			);
			expect(out.present).toHaveBeenCalledWith(
				expect.objectContaining({
					milestone: expect.objectContaining({ secondScore: id === 2 ? null : 4 }),
				}),
			);
		},
	);
	it.each(["update", "upsert"])("allows subject text %s on draft", async (mode) => {
		const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
		await new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
			{
				sheetId: 100,
				currentEmployeeId: 1,
				...(mode === "update" ? { milestoneId: 11 } : { goalNumber: 1 }),
				challengeGoal: "new",
				midtermGoal: "mid",
				achievement: "done",
			},
			out,
		);
		expect(mode === "update" ? milestones.updateText : milestones.upsertText).toHaveBeenCalled();
	});
	it("rejects no changes and score without milestone ID", async () => {
		const { sheets, milestones, scores, out } = setup();
		const interactor = new UpdateMilestoneInteractor(milestones, sheets, scores);
		await expect(interactor.execute({ sheetId: 100, currentEmployeeId: 2 }, out)).rejects.toThrow(
			"No milestone",
		);
		await expect(
			interactor.execute({ sheetId: 100, currentEmployeeId: 2, firstScore: 2 }, out),
		).rejects.toThrow("ID is required");
	});
});

describe("common evaluation updates", () => {
	const result = { id: 21, itemId: 31, firstComment: "x", firstScore: 3, secondScore: 5 };
	it.each([1, 4])("denies role %s without saving", async (id) => {
		const { sheets, scores, common, out } = setup();
		await expect(
			new UpsertCommonEvaluationInteractor(sheets, scores).execute(
				{ sheetId: 100, currentEmployeeId: id, results: [result] },
				out,
			),
		).rejects.toThrow("権限");
		expect(common.upsertResults).not.toHaveBeenCalled();
	});
	it.each([2, 3])("passes least privilege flags for evaluator %s", async (id) => {
		const { sheets, scores, common, out } = setup();
		await new UpsertCommonEvaluationInteractor(sheets, scores).execute(
			{ sheetId: 100, currentEmployeeId: id, results: [result] },
			out,
		);
		expect(common.upsertResults).toHaveBeenCalledWith(100, [result], id === 2, id === 3);
		expect(sheets.updateScoreTotals).toHaveBeenCalled();
		expect(out.present).toHaveBeenCalledWith({ sheetId: 100, success: true });
	});
	it.each([
		{ results: [{ ...result, itemId: 999 }] },
		{ results: [result, result] },
		{ results: [{ ...result, firstScore: 6 }] },
		{ results: [{ ...result, firstScore: NaN }] },
	])("rejects invalid batch before any write", async ({ results }) => {
		const { sheets, scores, common, out } = setup();
		await expect(
			new UpsertCommonEvaluationInteractor(sheets, scores).execute(
				{ sheetId: 100, currentEmployeeId: 2, results },
				out,
			),
		).rejects.toThrow();
		expect(common.upsertResults).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
});

describe("comments, final rank, status and notifications", () => {
	it.each([
		[2, "first"],
		[3, "second"],
	] as const)("allows evaluator %s comment %s", async (id, target) => {
		const { sheets, employees, out } = setup();
		await new UpdateOverallCommentInteractor(sheets, employees).execute(
			{ sheetId: 100, currentEmployeeId: id, target, comment: "comment" },
			out,
		);
		expect(sheets.updateOverallComment).toHaveBeenCalledWith(100, target, "comment");
	});
	it.each([
		[1, "first"],
		[2, "second"],
		[3, "first"],
		[4, "second"],
	] as const)("denies evaluator %s comment %s", async (id, target) => {
		const { sheets, employees, out } = setup();
		await expect(
			new UpdateOverallCommentInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: id, target, comment: "x" },
				out,
			),
		).rejects.toThrow("権限");
		expect(sheets.updateOverallComment).not.toHaveBeenCalled();
	});
	it.each([1, 2, 4])("denies final rank for role %s", async (id) => {
		const { sheets, employees, out } = setup();
		await expect(
			new UpdateFinalEvaluationRankInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: id, letter: "A", level: "none" },
				out,
			),
		).rejects.toThrow("二次評価者");
		expect(sheets.updateFinalEvaluationRank).not.toHaveBeenCalled();
	});
	it.each([
		{ letter: "X", level: "none" },
		{ letter: "A", level: "bad" },
		{ letter: "A" },
		{ level: "plus" },
	])("denies invalid or partial rank %j", async (rank) => {
		const { sheets, employees, out } = setup();
		await expect(
			new UpdateFinalEvaluationRankInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: 3, ...rank },
				out,
			),
		).rejects.toThrow();
		expect(sheets.updateFinalEvaluationRank).not.toHaveBeenCalled();
	});
	it("secondary evaluator can set or clear rank", async () => {
		const { sheets, employees, out } = setup();
		const interactor = new UpdateFinalEvaluationRankInteractor(sheets, employees);
		await interactor.execute(
			{ sheetId: 100, currentEmployeeId: 3, letter: "A", level: "plus" },
			out,
		);
		expect(sheets.updateFinalEvaluationRank).toHaveBeenLastCalledWith(
			100,
			expect.objectContaining({ letter: "A", level: "plus" }),
		);
		await interactor.execute({ sheetId: 100, currentEmployeeId: 3 }, out);
		expect(sheets.updateFinalEvaluationRank).toHaveBeenLastCalledWith(100, undefined);
	});
	it.each([
		[EvaluationStatus.DRAFT, 1, "submitted", false, "submitted"],
		[EvaluationStatus.SUBMITTED, 1, "draft", false, "draft"],
		[EvaluationStatus.SUBMITTED, 3, "submitted", true, "finalized"],
	] as const)(
		"allows transition %s by %s to %s (finalize=%s)",
		async (initial, id, status, asFinalization, expected) => {
			const { sheets, employees, out } = setup(initial);
			const notifications = { notifySheetFinalized: vi.fn().mockResolvedValue(undefined) };
			await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: id, status, asFinalization },
				out,
			);
			expect(sheets.updateStatus).toHaveBeenCalledWith(100, EvaluationStatus.from(expected));
			expect(notifications.notifySheetFinalized).toHaveBeenCalledTimes(asFinalization ? 1 : 0);
		},
	);
	it.each([
		[EvaluationStatus.DRAFT, 2, "submitted", false],
		[EvaluationStatus.DRAFT, 3, "submitted", true],
		[EvaluationStatus.SUBMITTED, 2, "submitted", true],
		[EvaluationStatus.SUBMITTED, 3, "draft", true],
		[EvaluationStatus.FINALIZED, 1, "draft", false],
		[EvaluationStatus.FINALIZED, 3, "submitted", true],
	] as const)(
		"rejects forbidden transition %s by %s to %s (finalize=%s)",
		async (initial, id, status, asFinalization) => {
			const { sheets, employees, out } = setup(initial);
			const notifications = { notifySheetFinalized: vi.fn() };
			await expect(
				new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
					{ sheetId: 100, currentEmployeeId: id, status, asFinalization },
					out,
				),
			).rejects.toThrow();
			expect(sheets.updateStatus).not.toHaveBeenCalled();
			expect(notifications.notifySheetFinalized).not.toHaveBeenCalled();
		},
	);
	it("failed save cannot send finalization notification or present success", async () => {
		const { sheets, employees, out } = setup();
		const notifications = { notifySheetFinalized: vi.fn() };
		sheets.updateStatus.mockRejectedValue(new Error("DB unavailable"));
		await expect(
			new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: 3, status: "submitted", asFinalization: true },
				out,
			),
		).rejects.toThrow("DB unavailable");
		expect(notifications.notifySheetFinalized).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it("notification failure does not undo saved finalization", async () => {
		const { sheets, employees, out } = setup();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const notifications = {
			notifySheetFinalized: vi.fn().mockRejectedValue(new Error("SMTP unavailable")),
		};
		await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
			{ sheetId: 100, currentEmployeeId: 3, status: "submitted", asFinalization: true },
			out,
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({ sheet: expect.objectContaining({ status: "finalized" }) }),
		);
	});
	it.each(["comment", "rank", "status", "milestone", "common", "loadCommon"])(
		"missing sheet fails closed for %s",
		async (kind) => {
			const { sheets, employees, milestones, common, scores, out } = setup();
			sheets.findById.mockResolvedValue(null);
			const run = () => {
				switch (kind) {
					case "comment":
						return new UpdateOverallCommentInteractor(sheets, employees).execute(
							{ sheetId: 100, currentEmployeeId: 2, target: "first", comment: "x" },
							out,
						);
					case "rank":
						return new UpdateFinalEvaluationRankInteractor(sheets, employees).execute(
							{ sheetId: 100, currentEmployeeId: 3 },
							out,
						);
					case "status":
						return new UpdateEvaluationStatusInteractor(sheets, employees).execute(
							{ sheetId: 100, currentEmployeeId: 3, status: "submitted" },
							out,
						);
					case "milestone":
						return new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
							{ sheetId: 100, currentEmployeeId: 1 },
							out,
						);
					case "common":
						return new UpsertCommonEvaluationInteractor(sheets, scores).execute(
							{ sheetId: 100, currentEmployeeId: 2, results: [] },
							out,
						);
					default:
						return new LoadCommonEvaluationInteractor(common, sheets).execute(
							{ sheetId: 100, currentEmployeeId: 2, gradeId: 5 },
							out,
						);
				}
			};
			await expect(run()).rejects.toThrow("見つかりません");
			expect(out.present).not.toHaveBeenCalled();
		},
	);
});
