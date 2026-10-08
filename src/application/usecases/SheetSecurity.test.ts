import { describe, expect, it, vi } from "vitest";
import { Employee } from "../../domain/entities/Employee";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	commonRepository,
	commonResult,
	employeeRepository,
	milestone,
	milestoneRepository,
	output,
	period,
	sheet,
	sheetRepository,
} from "../../test/fixtures";
import { CheckEvaluatorRoleInteractor } from "./CheckEvaluatorRoleInteractor";
import { FetchEvaluationSheetInteractor } from "./FetchEvaluationSheetInteractor";
import { LoadCommonEvaluationInteractor } from "./LoadCommonEvaluationInteractor";
import { UpdateEvaluationStatusInteractor } from "./UpdateEvaluationStatusInteractor";
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
/** 評価者が入力できる段階。一次評価者は提出済み、二次評価者は一次評価の確定後。 */
const stageOf = (evaluatorId: number) =>
	evaluatorId === 3 ? EvaluationStatus.FIRST_EVALUATED : EvaluationStatus.SUBMITTED;
const notificationRepository = () => ({
	notifySheetSubmitted: vi.fn().mockResolvedValue(undefined),
	notifyFirstEvaluationConfirmed: vi.fn().mockResolvedValue(undefined),
	notifySheetFinalized: vi.fn().mockResolvedValue(undefined),
});

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
		expect(dto.commonEvaluationScoreTotals.firstTotalScore).toBe(id === 1 ? null : 15);
		expect(dto.commonEvaluationScoreTotals.secondTotalScore).toBe(id === 3 ? 20 : null);
		expect(dto.allocatedScores.commonEvaluationSecondRate).toBe(id === 3 ? 100 : null);
		expect(dto.allocatedScores.totalEvaluationScore).toBe(id === 3 ? 100 : null);
		// ランクは点数から決まる(一次 70点 → B、二次 100点 → S)。保存値の A+ は確定前には使わない
		expect(dto.firstEvaluationRank?.displayText).toBe(id === 1 ? undefined : "B");
		expect(dto.finalEvaluationRank).toEqual(
			id === 3 ? { displayText: "S", score: 100, confirmed: false } : undefined,
		);
	});
	it.each([1, 4])("does not query common evaluation for unauthorized role %s", async (id) => {
		const { sheets, common, out } = setup();
		await expect(
			new LoadCommonEvaluationInteractor(common, sheets, employeeRepository()).execute(
				{ sheetId: 100, gradeId: 99, currentEmployeeId: id },
				out,
			),
		).rejects.toThrow("権限");
		expect(common.findResultsBySheetId).not.toHaveBeenCalled();
	});
	it("lists the common evaluation items of the grade held when the sheet was created", async () => {
		const { sheets, common } = setup();
		sheets.findById.mockResolvedValue(sheet(EvaluationStatus.SUBMITTED, 3));
		await new LoadCommonEvaluationInteractor(common, sheets, employeeRepository()).execute(
			{ sheetId: 100, gradeId: 99, currentEmployeeId: 2 },
			output(),
		);
		// 社員の今の等級(5)でも、画面から渡された値(99)でもない
		expect(common.findResultsBySheetId).toHaveBeenCalledWith(100, 3);
	});
	it.each([2, 3])("uses the sheet grade and masks common secondary scores for %s", async (id) => {
		const { sheets, common } = setup();
		const out = output<import("./LoadCommonEvaluationInteractor").LoadCommonEvaluationResponse>();
		await new LoadCommonEvaluationInteractor(common, sheets, employeeRepository()).execute(
			{ sheetId: 100, gradeId: 99, currentEmployeeId: id },
			out,
		);
		expect(common.findResultsBySheetId).toHaveBeenCalledWith(100, 5);
		expect(out.present.mock.calls[0][0]).toMatchObject({
			totalSecondScore: id === 3 ? 20 : null,
			secondRate: id === 3 ? 100 : null,
			results: [expect.objectContaining({ secondScore: id === 3 ? 4 : null })],
		});
	});
});

describe("an Admin outside the evaluation", () => {
	/** 4 は本人でも評価者でもない社員。権限だけが Admin。 */
	const asAdmin = (status = EvaluationStatus.SUBMITTED) => {
		const context = setup(status);
		context.employees.findRole.mockResolvedValue(EmployeeRole.ADMIN);
		return context;
	};
	it.each([EvaluationStatus.DRAFT, EvaluationStatus.FIRST_EVALUATED])(
		"reads the whole sheet in %s, with nothing masked",
		async (status) => {
			const { sheets, employees, common } = asAdmin(status);
			const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
			await new FetchEvaluationSheetInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: 4 },
				out,
			);
			expect(employees.findRole).toHaveBeenCalledWith(4);
			expect(out.present.mock.calls[0][0]).toMatchObject({
				objectives: [{ challengeGoal: "目標", firstScore: 2, secondScore: 4 }],
				firstOverallComment: "一次総評",
				secondOverallComment: "二次総評",
				commonEvaluationScoreTotals: { firstTotalScore: 15, secondTotalScore: 20 },
				allocatedScores: { totalEvaluationScore: 100 },
			});
			const commonOut =
				output<import("./LoadCommonEvaluationInteractor").LoadCommonEvaluationResponse>();
			await new LoadCommonEvaluationInteractor(common, sheets, employees).execute(
				{ sheetId: 100, gradeId: 99, currentEmployeeId: 4 },
				commonOut,
			);
			expect(commonOut.present.mock.calls[0][0]).toMatchObject({
				totalSecondScore: 20,
				results: [expect.objectContaining({ firstScore: 3, secondScore: 4 })],
			});
		},
	);
	it("is told it is only viewing, and gets no permission to change anything", async () => {
		const { sheets, employees } = asAdmin();
		const out = output<import("./CheckEvaluatorRoleInteractor").CheckEvaluatorRoleResponse>();
		employees.findCurrentEmployeeId.mockResolvedValue({ data: 4, error: null });
		await new CheckEvaluatorRoleInteractor(employees, sheets).execute({ sheetId: 100 }, out);
		const { viewingAsAdmin, canViewCommonEvaluation, canViewSecondEvaluation, ...changes } =
			out.present.mock.calls[0][0];
		expect({ viewingAsAdmin, canViewCommonEvaluation, canViewSecondEvaluation }).toEqual({
			viewingAsAdmin: true,
			canViewCommonEvaluation: true,
			canViewSecondEvaluation: true,
		});
		expect(Object.values(changes).every((allowed) => allowed === false)).toBe(true);
	});
	it("cannot evaluate, comment or finalize: the update use cases still refuse", async () => {
		const { sheets, employees, milestones, scores, out } = asAdmin();
		await expect(
			new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
				{ sheetId: 100, milestoneId: 11, firstScore: 4, currentEmployeeId: 4 },
				out,
			),
		).rejects.toThrow();
		await expect(
			new UpsertCommonEvaluationInteractor(sheets, scores).execute(
				{
					sheetId: 100,
					currentEmployeeId: 4,
					results: [{ id: 21, itemId: 31, firstScore: 4, secondScore: 0, firstComment: "" }],
				},
				out,
			),
		).rejects.toThrow();
		await expect(
			new UpdateOverallCommentInteractor(sheets, employees).execute(
				{ sheetId: 100, target: "first", comment: "書き換え", currentEmployeeId: 4 },
				out,
			),
		).rejects.toThrow();
		await expect(
			new UpdateEvaluationStatusInteractor(sheets, employees, notificationRepository()).execute(
				{ sheetId: 100, currentEmployeeId: 4, status: EvaluationStatus.FIRST_EVALUATED },
				out,
			),
		).rejects.toThrow();
		expect(milestones.updateScore).not.toHaveBeenCalled();
		expect(sheets.updateOverallComment).not.toHaveBeenCalled();
		expect(sheets.updateStatus).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
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
	it.each([0, -1, 1.5, NaN, 5])("rejects invalid goal number %s", async (goalNumber) => {
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
			const { sheets, milestones, scores, out } = setup(stageOf(id));
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
	// 評価は 1〜4。配点(5)は係数なので、点数の上限ではない
	const result = { id: 21, itemId: 31, firstComment: "x", firstScore: 3, secondScore: 4 };
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
		const { sheets, scores, common, out } = setup(stageOf(id));
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
		const { sheets, employees, out } = setup(stageOf(id));
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
		// 段階が違えば、担当の評価者でも入力できない
		[2, "first", EvaluationStatus.FIRST_EVALUATED],
		[3, "second", EvaluationStatus.SUBMITTED],
		[3, "second", EvaluationStatus.FINALIZED],
	] as const)("denies evaluator %s comment %s", async (id, target, status = undefined) => {
		const { sheets, employees, out } = setup(status);
		await expect(
			new UpdateOverallCommentInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: id, target, comment: "x" },
				out,
			),
		).rejects.toThrow("権限");
		expect(sheets.updateOverallComment).not.toHaveBeenCalled();
	});
	it.each([
		[EvaluationStatus.DRAFT, 1, "submitted"],
		[EvaluationStatus.SUBMITTED, 1, "draft"],
		[EvaluationStatus.SUBMITTED, 2, "first_evaluated"],
		[EvaluationStatus.FIRST_EVALUATED, 3, "finalized"],
	] as const)("allows transition %s by %s to %s", async (initial, id, status) => {
		const { sheets, employees, out } = setup(initial);
		const notifications = notificationRepository();
		await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
			{ sheetId: 100, currentEmployeeId: id, status: EvaluationStatus.from(status) },
			out,
		);
		expect(sheets.updateStatus).toHaveBeenCalledWith(
			100,
			EvaluationStatus.from(status),
			expect.anything(),
		);
		// 提出は一次評価者へ、一次評価の確定は二次評価者へ、評価の確定は評価者へ知らせる。下書きに戻すときは知らせない
		expect(notifications.notifySheetSubmitted).toHaveBeenCalledTimes(
			status === "submitted" ? 1 : 0,
		);
		expect(notifications.notifyFirstEvaluationConfirmed).toHaveBeenCalledTimes(
			status === "first_evaluated" ? 1 : 0,
		);
		expect(notifications.notifySheetFinalized).toHaveBeenCalledTimes(
			status === "finalized" ? 1 : 0,
		);
	});
	it.each([
		[EvaluationStatus.DRAFT, 2, "submitted"],
		[EvaluationStatus.DRAFT, 2, "first_evaluated"],
		[EvaluationStatus.DRAFT, 3, "finalized"],
		// 一次評価が確定するまで、二次評価者は確定できない
		[EvaluationStatus.SUBMITTED, 3, "finalized"],
		[EvaluationStatus.SUBMITTED, 3, "first_evaluated"],
		[EvaluationStatus.SUBMITTED, 1, "first_evaluated"],
		[EvaluationStatus.SUBMITTED, 2, "finalized"],
		// 一次評価の確定後は、本人も一次評価者も元に戻せない
		[EvaluationStatus.FIRST_EVALUATED, 1, "draft"],
		[EvaluationStatus.FIRST_EVALUATED, 2, "submitted"],
		[EvaluationStatus.FIRST_EVALUATED, 2, "first_evaluated"],
		[EvaluationStatus.FIRST_EVALUATED, 2, "finalized"],
		[EvaluationStatus.FINALIZED, 1, "draft"],
		[EvaluationStatus.FINALIZED, 3, "finalized"],
	] as const)("rejects forbidden transition %s by %s to %s", async (initial, id, status) => {
		const { sheets, employees, out } = setup(initial);
		const notifications = notificationRepository();
		await expect(
			new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: id, status: EvaluationStatus.from(status) },
				out,
			),
		).rejects.toThrow();
		expect(sheets.updateStatus).not.toHaveBeenCalled();
		expect(notifications.notifyFirstEvaluationConfirmed).not.toHaveBeenCalled();
		expect(notifications.notifySheetFinalized).not.toHaveBeenCalled();
	});
	it("stores the rank decided by the score rate when each stage is confirmed", async () => {
		// 一次評価 70点 → B、二次評価 100点 → S。評価者はランクを選べない
		const first = setup();
		await new UpdateEvaluationStatusInteractor(first.sheets, first.employees).execute(
			{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FIRST_EVALUATED },
			first.out,
		);
		expect(first.sheets.updateStatus).toHaveBeenCalledWith(100, EvaluationStatus.FIRST_EVALUATED, {
			first: expect.objectContaining({ letter: "B", level: "none" }),
		});
		expect(first.sheets.updateScoreTotals).not.toHaveBeenCalled();

		const final = setup(EvaluationStatus.FIRST_EVALUATED);
		await new UpdateEvaluationStatusInteractor(final.sheets, final.employees).execute(
			{ sheetId: 100, currentEmployeeId: 3, status: EvaluationStatus.FINALIZED },
			final.out,
		);
		expect(final.sheets.updateStatus).toHaveBeenCalledWith(100, EvaluationStatus.FINALIZED, {
			final: expect.objectContaining({ letter: "S", level: "none" }),
		});
	});
	it("failed save cannot send a notification or present success", async () => {
		const { sheets, employees, out } = setup(EvaluationStatus.FIRST_EVALUATED);
		const notifications = notificationRepository();
		sheets.updateStatus.mockRejectedValue(new Error("DB unavailable"));
		await expect(
			new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: 3, status: EvaluationStatus.FINALIZED },
				out,
			),
		).rejects.toThrow("DB unavailable");
		expect(notifications.notifySheetFinalized).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it.each([
		[EvaluationStatus.DRAFT, 1, "submitted", "一次評価者"],
		[EvaluationStatus.SUBMITTED, 2, "first_evaluated", "二次評価者"],
		[EvaluationStatus.FIRST_EVALUATED, 3, "finalized", "評価者"],
	] as const)(
		"notification failure does not undo the saved stage %s by %s to %s",
		async (initial, id, status, recipient) => {
			const { sheets, employees } = setup(initial);
			vi.spyOn(console, "error").mockImplementation(() => {});
			const notifications = {
				notifySheetSubmitted: vi.fn().mockRejectedValue(new Error("SMTP unavailable")),
				notifyFirstEvaluationConfirmed: vi.fn().mockRejectedValue(new Error("SMTP unavailable")),
				notifySheetFinalized: vi.fn().mockRejectedValue(new Error("SMTP unavailable")),
			};
			const out = { present: vi.fn(), presentNotificationDelivery: vi.fn() };
			await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: id, status: EvaluationStatus.from(status) },
				out,
			);
			expect(out.present).toHaveBeenCalledWith({ sheet: expect.objectContaining({ status }) });
			// 誰にも送れなかった理由を、確定とは別に後から知らせる
			await vi.waitFor(() =>
				expect(out.presentNotificationDelivery).toHaveBeenCalledExactlyOnceWith({
					recipient,
					error: "SMTP unavailable",
				}),
			);
		},
	);
	it("presents the saved stage without waiting for mail, then each delivery as it finishes", async () => {
		const { sheets, employees } = setup(EvaluationStatus.FIRST_EVALUATED);
		let deliver!: () => void;
		const notifications = {
			notifySheetSubmitted: vi.fn(),
			notifyFirstEvaluationConfirmed: vi.fn(),
			notifySheetFinalized: vi.fn(
				(_notification: unknown, report: (delivery: { recipient: string }) => void) =>
					new Promise<void>((resolve) => {
						deliver = () => {
							report({ recipient: "一次（一次評価者）" });
							resolve();
						};
					}),
			),
		};
		const out = { present: vi.fn(), presentNotificationDelivery: vi.fn() };
		await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
			{ sheetId: 100, currentEmployeeId: 3, status: EvaluationStatus.FINALIZED },
			out,
		);
		expect(out.present).toHaveBeenCalledOnce();
		expect(notifications.notifySheetFinalized).toHaveBeenCalledWith(
			expect.objectContaining({ primaryEvaluatorName: "一次", secondaryEvaluatorName: "二次" }),
			expect.any(Function),
		);
		expect(out.presentNotificationDelivery).not.toHaveBeenCalled();
		deliver();
		expect(out.presentNotificationDelivery).toHaveBeenCalledExactlyOnceWith({
			recipient: "一次（一次評価者）",
		});
	});
	it.each([
		[EvaluationStatus.SUBMITTED, 2, "first_evaluated"],
		[EvaluationStatus.FIRST_EVALUATED, 3, "finalized"],
	] as const)(
		"confirms %s by %s to %s without mail when notification is turned off",
		async (initial, id, status) => {
			const { sheets, employees, out } = setup(initial);
			const notifications = notificationRepository();
			await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{
					sheetId: 100,
					currentEmployeeId: id,
					status: EvaluationStatus.from(status),
					notify: false,
				},
				out,
			);
			expect(out.present).toHaveBeenCalledWith({ sheet: expect.objectContaining({ status }) });
			expect(notifications.notifySheetSubmitted).not.toHaveBeenCalled();
			expect(notifications.notifyFirstEvaluationConfirmed).not.toHaveBeenCalled();
			expect(notifications.notifySheetFinalized).not.toHaveBeenCalled();
		},
	);
	it("primary evaluator finalizes with their own evaluation when secondary is explicitly none", async () => {
		const { sheets, employees, out } = setup();
		const withoutSecondary = (status: EvaluationStatus) =>
			EvaluationSheet.create({
				sheetId: 100,
				subject: new Employee(1, "テスト社員", "TEST001", 1, "技術", 5, 2, null, true),
				evaluationPeriod: period(),
				primaryEvaluatorName: "一次",
				secondaryEvaluatorName: "なし",
				objectives: [milestone()],
				commonEvaluationResults: [commonResult()],
				status,
			});
		sheets.findById.mockResolvedValue(withoutSecondary(EvaluationStatus.SUBMITTED));
		sheets.updateStatus.mockImplementation(async (_id, status) => withoutSecondary(status));
		const interactor = new UpdateEvaluationStatusInteractor(sheets, employees);

		// 二次評価者ではない社員(3)は確定できない
		await expect(
			interactor.execute(
				{ sheetId: 100, currentEmployeeId: 3, status: EvaluationStatus.FINALIZED },
				out,
			),
		).rejects.toThrow("最終評価者");
		// 一次評価者の確定がそのまま評価の確定になるので、「一次評価済み」の段は通らない
		await expect(
			interactor.execute(
				{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FIRST_EVALUATED },
				out,
			),
		).rejects.toThrow("一次評価者");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();

		await interactor.execute(
			{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FINALIZED },
			out,
		);
		// 一次評価 (目標50%・共通75%) が最終評価の集計として保存される
		expect(sheets.updateScoreTotals).toHaveBeenCalledWith(100, {
			objectives: expect.objectContaining({ secondTotalScore: 2, secondTotalRate: 50 }),
			commonEvaluationResults: expect.objectContaining({
				secondTotalScore: 15,
				secondTotalRate: 75,
			}),
			allocatedScores: expect.objectContaining({ totalEvaluationScore: 70 }),
		});
		// 一次評価 70点 → B が、一次評価ランクと最終評価ランクの両方になる
		expect(sheets.updateStatus).toHaveBeenCalledWith(100, EvaluationStatus.FINALIZED, {
			first: expect.objectContaining({ letter: "B", level: "none" }),
			final: expect.objectContaining({ letter: "B", level: "none" }),
		});
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({
				sheet: expect.objectContaining({
					status: "finalized",
					allocatedScores: expect.objectContaining({ totalEvaluationScore: 70 }),
				}),
			}),
		);
	});
	it.each(["comment", "status", "milestone", "common", "loadCommon"])(
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
					case "status":
						return new UpdateEvaluationStatusInteractor(sheets, employees).execute(
							{ sheetId: 100, currentEmployeeId: 3, status: EvaluationStatus.SUBMITTED },
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
						return new LoadCommonEvaluationInteractor(common, sheets, employeeRepository()).execute(
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

it("rejects removing the last goal before writing", async () => {
	const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
	await expect(
		new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
			{ sheetId: 100, currentEmployeeId: 1, milestoneId: 11, delete: true },
			out,
		),
	).rejects.toThrow("最低1件");
	expect(milestones.delete).not.toHaveBeenCalled();
});
it.each([1, 2])("allows only the subject to delete a tab (%s)", async (employeeId) => {
	const { sheets, milestones, scores, out } = setup(EvaluationStatus.DRAFT);
	sheets.findById.mockResolvedValue(
		EvaluationSheet.create({
			...sheet(EvaluationStatus.DRAFT),
			objectives: [
				milestone(),
				Milestone.create({ ...milestone(), id: 12, goalNumber: 2, firstScore: 0, secondScore: 0 }),
			],
		}),
	);
	const result = new UpdateMilestoneInteractor(milestones, sheets, scores).execute(
		{ sheetId: 100, currentEmployeeId: employeeId, milestoneId: 12, delete: true },
		out,
	);
	if (employeeId === 1) {
		await result;
		expect(milestones.delete).toHaveBeenCalledWith(12);
	} else {
		await expect(result).rejects.toThrow("削除");
		expect(milestones.delete).not.toHaveBeenCalled();
	}
});
