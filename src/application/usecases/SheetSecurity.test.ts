import { describe, expect, it, vi } from "vitest";
import { Employee } from "../../domain/entities/Employee";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import type { Result } from "../../domain/Result";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	commonRepository,
	commonResult,
	employeeRepository,
	masterRepository,
	milestone,
	milestoneRepository,
	output,
	period,
	profile,
	sheet,
	sheetRepository,
} from "../../test/fixtures";
import { FetchEvaluationSheetInteractor } from "./FetchEvaluationSheetInteractor";
import { UpdateEvaluationStatusInteractor } from "./UpdateEvaluationStatusInteractor";
import { type MilestoneTextChanges, UpdateMilestoneInteractor } from "./UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./UpdateOverallCommentInteractor";
import { UpsertCommonEvaluationInteractor } from "./UpsertCommonEvaluationInteractor";

function setup(status = EvaluationStatus.SUBMITTED) {
	const sheets = sheetRepository();
	sheets.findById.mockResolvedValue(sheet(status));
	const employees = employeeRepository();
	const milestones = milestoneRepository();
	const common = commonRepository();
	return { sheets, employees, milestones, common, out: output<never>() };
}
/** 評価者が入力できる段階。一次評価者は一次評価待ち、二次評価者は一次評価の確定後。 */
const stageOf = (evaluatorId: number) =>
	evaluatorId === 3 ? EvaluationStatus.FIRST_EVALUATED : EvaluationStatus.SUBMITTED;
const notificationRepository = () => ({
	notifySheetStatusChanged: vi.fn().mockResolvedValue(undefined),
});

async function expectResultError<T, E extends { kind: string }>(
	result: Promise<Result<T, E>>,
	error: Partial<E>,
) {
	expect(await result).toMatchObject({ ok: false, error });
}

describe("sheet reading and confidentiality", () => {
	it.each([null, 4])("denies viewer %s without presenting personal data", async (id) => {
		const { sheets, employees, out } = setup();
		await expect(
			new FetchEvaluationSheetInteractor(sheets, employees, masterRepository()).execute(
				{ sheetId: 100, currentEmployeeId: id },
				out,
			),
		).rejects.toThrow("権限");
		expect(out.present).not.toHaveBeenCalled();
		expect(employees.findGradeName).not.toHaveBeenCalled();
	});
	it("fails closed for a missing sheet", async () => {
		const { sheets, employees, out } = setup();
		sheets.findById.mockResolvedValue(null);
		await expect(
			new FetchEvaluationSheetInteractor(sheets, employees, masterRepository()).execute(
				{ sheetId: 100, currentEmployeeId: 1 },
				out,
			),
		).rejects.toThrow("見つかりません");
		expect(out.present).not.toHaveBeenCalled();
		expect(employees.findGradeName).not.toHaveBeenCalled();
	});
	it.each([1, 2, 3])("redacts all restricted fields for role %s", async (id) => {
		const { sheets, employees } = setup();
		const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
		await new FetchEvaluationSheetInteractor(sheets, employees, masterRepository()).execute(
			{ sheetId: 100, currentEmployeeId: id },
			out,
		);
		const dto = out.present.mock.calls[0][0];
		// 本人(1)には、確定前の目標の点数を伏せる
		expect(dto.objectives[0].firstScore === null).toBe(id === 1);
		expect(dto.objectiveScoreTotals.firstTotalScore === null).toBe(id === 1);
		expect(dto.objectives[0].secondScore).toBe(id === 3 ? 4 : null);
		expect(dto.objectiveScoreTotals.secondTotalScore).toBe(id === 3 ? 4 : null);
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
	it("does not present common evaluation to the subject", async () => {
		const { sheets, employees } = setup();
		const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
		// 評価関係のない人(4)は、シートごと断る(denies viewer)
		await new FetchEvaluationSheetInteractor(sheets, employees, masterRepository()).execute(
			{ sheetId: 100, currentEmployeeId: 1 },
			out,
		);
		expect(out.present.mock.calls[0][0].commonEvaluation).toBeNull();
	});
	it.each([2, 3])(
		"lists the sheet's own items and masks common secondary scores for %s",
		async (id) => {
			const { sheets, employees } = setup();
			const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
			await new FetchEvaluationSheetInteractor(sheets, employees, masterRepository()).execute(
				{ sheetId: 100, currentEmployeeId: id },
				out,
			);
			expect(out.present.mock.calls[0][0].commonEvaluation).toMatchObject({
				totalFirstScore: 15,
				firstRate: 75,
				totalWeight: 5,
				totalSecondScore: id === 3 ? 20 : null,
				secondRate: id === 3 ? 100 : null,
				results: [
					expect.objectContaining({
						itemId: 31,
						firstScore: 3,
						secondScore: id === 3 ? 4 : null,
						item: expect.objectContaining({ title: "共通項目", weight: 5 }),
					}),
				],
			});
		},
	);
});

describe("Admin reads any sheet, read-only", () => {
	const read = async (
		viewerId: number,
		role: string | null,
		status = EvaluationStatus.SUBMITTED,
	) => {
		const { sheets, employees } = setup(status);
		const master = masterRepository();
		master.findCurrentEmployeeProfile.mockResolvedValue(role ? profile(role, viewerId) : null);
		const out = output<import("../dtos/EvaluationSheetDto").EvaluationSheetDto>();
		const run = new FetchEvaluationSheetInteractor(sheets, employees, master).execute(
			{ sheetId: 100, currentEmployeeId: viewerId },
			out,
		);
		return { run, out, master };
	};

	it.each(EvaluationStatus.ALL)(
		"shows an Admin with no part in the sheet everything at %s, and offers no action",
		async (status) => {
			const { run, out } = await read(4, "Admin", status);
			await run;
			const dto = out.present.mock.calls[0][0];
			expect(dto.objectives[0]).toMatchObject({ firstScore: 2, secondScore: 4 });
			expect(dto.firstOverallComment).toBe("一次総評");
			expect(dto.secondOverallComment).toBe("二次総評");
			expect(dto.commonEvaluation?.totalSecondScore).toBe(20);
			const { isSubject, canViewCommonEvaluation, canViewSecondEvaluation, viewsAsAdmin, ...acts } =
				dto.permissions;
			expect({ isSubject, canViewCommonEvaluation, canViewSecondEvaluation, viewsAsAdmin }).toEqual(
				{
					isSubject: false,
					canViewCommonEvaluation: true,
					canViewSecondEvaluation: true,
					viewsAsAdmin: true,
				},
			);
			expect(Object.values(acts).every((can) => can === false)).toBe(true);
			expect(dto.pendingEvaluationItems).toBeUndefined();
		},
	);

	it.each([
		["Reviewer", "Reviewer"],
		["Employee", "Employee"],
		["no profile (disabled or unlinked)", null],
	])("still refuses a non-Admin with no part in the sheet: %s", async (_label, role) => {
		const { run, out } = await read(4, role);
		await expect(run).rejects.toThrow("権限");
		expect(out.present).not.toHaveBeenCalled();
	});

	it("does not ask who the viewer is when they already have a part in the sheet", async () => {
		const { run, out, master } = await read(2, "Admin");
		await run;
		expect(master.findCurrentEmployeeProfile).not.toHaveBeenCalled();
		// 一次評価者の Admin は、一次評価者として見る(二次評価は伏せる)
		expect(out.present.mock.calls[0][0]).toMatchObject({
			secondOverallComment: "",
			permissions: { viewsAsAdmin: false },
		});
	});
});

describe("milestone updates validate before side effects", () => {
	type Setup = ReturnType<typeof setup>;
	const use = (milestones: Setup["milestones"], sheets: Setup["sheets"]) =>
		new UpdateMilestoneInteractor(milestones, sheets);
	const text = (change: MilestoneTextChanges, milestoneId = 11, currentEmployeeId = 1) =>
		({ action: "text", sheetId: 100, currentEmployeeId, milestoneId, ...change }) as const;
	const upsert = (goalNumber: number, change: MilestoneTextChanges) =>
		({ action: "upsertText", sheetId: 100, currentEmployeeId: 1, goalNumber, ...change }) as const;
	const score = (
		currentEmployeeId: number,
		scores: { firstScore?: number; secondScore?: number },
	) => ({ action: "score", sheetId: 100, currentEmployeeId, milestoneId: 11, ...scores }) as const;

	it.each(["update", "upsert"])("partial text %s preserves omitted fields", async (mode) => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		await use(milestones, sheets).execute(
			mode === "update" ? text({ challengeGoal: "new" }) : upsert(1, { challengeGoal: "new" }),
			out,
		);
		expect(mode === "update" ? milestones.updateText : milestones.upsertText).toHaveBeenCalledWith(
			...(mode === "update"
				? [11, "new", [{ description: "手順を見直す", achievement: "達成" }], ""]
				: [100, 1, "new", [{ description: "手順を見直す", achievement: "達成" }], ""]),
		);
	});
	it.each(["text", "score", "delete"] as const)(
		"rejects a milestone from another sheet (%s)",
		async (action) => {
			const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
			const target = { sheetId: 100, currentEmployeeId: 1, milestoneId: 999 };
			await expectResultError(
				use(milestones, sheets).execute(
					action === "text"
						? text({ challengeGoal: "attack" }, 999)
						: action === "score"
							? { action, ...target, firstScore: 4 }
							: { action, ...target },
					out,
				),
				{ kind: "goalNotOnSheet" },
			);
			expect(milestones.updateText).not.toHaveBeenCalled();
			expect(milestones.updateScore).not.toHaveBeenCalled();
			expect(milestones.delete).not.toHaveBeenCalled();
		},
	);
	it("ignores score fields smuggled into a text request", async () => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		await use(milestones, sheets).execute(
			{ ...text({ challengeGoal: "changed" }), firstScore: 4 } as never,
			out,
		);
		expect(milestones.updateText).toHaveBeenCalledOnce();
		expect(milestones.updateScore).not.toHaveBeenCalled();
	});
	it("rejects an unknown action and an empty change before writing", async () => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		await expectResultError(
			use(milestones, sheets).execute({ ...text({}), action: "overwrite" } as never, out),
			{ kind: "actionUnknown" },
		);
		await expectResultError(use(milestones, sheets).execute(text({}), out), {
			kind: "nothingToSave",
		});
		const evaluator = setup();
		await expectResultError(
			use(evaluator.milestones, evaluator.sheets).execute(score(2, {}), out),
			{ kind: "nothingToSave" },
		);
		expect(milestones.updateText).not.toHaveBeenCalled();
		expect(evaluator.milestones.updateScore).not.toHaveBeenCalled();
	});
	it.each([-1, 5, 0.5, NaN, Infinity])("rejects score %s before persisting", async (firstScore) => {
		const { sheets, milestones, out } = setup();
		await expectResultError(use(milestones, sheets).execute(score(2, { firstScore }), out), {
			kind: "scoreOutOfRange",
		});
		expect(milestones.updateScore).not.toHaveBeenCalled();
	});
	it.each([0, -1, 1.5, NaN, 5])("rejects invalid goal number %s", async (goalNumber) => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		await expectResultError(
			use(milestones, sheets).execute(upsert(goalNumber, { challengeGoal: "x" }), out),
			{ kind: "goalNumberInvalid" },
		);
		expect(milestones.upsertText).not.toHaveBeenCalled();
	});
	it.each([EvaluationStatus.SUBMITTED, EvaluationStatus.FINALIZED])(
		"denies subject editing locked goal (%s)",
		async (status) => {
			const { sheets, milestones, out } = setup(status);
			await expectResultError(use(milestones, sheets).execute(text({ challengeGoal: "x" }), out), {
				kind: "forbidden",
				action: "editGoalText",
			});
			expect(milestones.updateText).not.toHaveBeenCalled();
		},
	);
	it.each([2, 3])("writes only permitted evaluator score %s and reads totals back", async (id) => {
		const { sheets, milestones, out } = setup(stageOf(id));
		await use(milestones, sheets).execute(
			score(id, id === 2 ? { firstScore: 2 } : { secondScore: 4 }),
			out,
		);
		expect(milestones.updateScore).toHaveBeenCalledWith(
			11,
			id === 2 ? 2 : undefined,
			id === 3 ? 4 : undefined,
		);
		// 集計は DB が行い、保存の後に読み直す
		expect(milestones.updateScore.mock.invocationCallOrder[0]).toBeLessThan(
			sheets.findById.mock.invocationCallOrder[1],
		);
		expect(out.present).toHaveBeenCalledWith(
			expect.objectContaining({
				milestone: expect.objectContaining({ secondScore: id === 2 ? null : 4 }),
			}),
		);
	});
	it.each([
		// 一次点は、一次評価待ちの一次評価者だけ
		[1, EvaluationStatus.SUBMITTED, { firstScore: 4 }, "editFirstScore"],
		[3, EvaluationStatus.SUBMITTED, { firstScore: 4 }, "editFirstScore"],
		[4, EvaluationStatus.SUBMITTED, { firstScore: 4 }, "editFirstScore"],
		[2, EvaluationStatus.FIRST_EVALUATED, { firstScore: 4 }, "editFirstScore"],
		[2, EvaluationStatus.GOALS_CONFIRMED, { firstScore: 4 }, "editFirstScore"],
		// 二次点は、一次評価が確定した後の二次評価者だけ
		[1, EvaluationStatus.FIRST_EVALUATED, { secondScore: 4 }, "editSecondScore"],
		[2, EvaluationStatus.FIRST_EVALUATED, { secondScore: 4 }, "editSecondScore"],
		[3, EvaluationStatus.SUBMITTED, { secondScore: 4 }, "editSecondScore"],
		[3, EvaluationStatus.FINALIZED, { secondScore: 4 }, "editSecondScore"],
	] as const)("refuses a score from %s at %s: %o", async (id, status, scores, action) => {
		const { sheets, milestones, out } = setup(status);
		await expectResultError(use(milestones, sheets).execute(score(id, scores), out), {
			kind: "forbidden",
			action,
		});
		expect(milestones.updateScore).not.toHaveBeenCalled();
	});
	it("refuses a new goal while the sheet already holds as many goals as the lowered limit", async () => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		// 上限を 4 から 2 に下げる前に、目標 3・4 を書いていた
		sheets.findById.mockResolvedValue(
			EvaluationSheet.create({
				...sheet(EvaluationStatus.DRAFT),
				maxObjectives: 2,
				objectives: [3, 4].map((goalNumber) =>
					Milestone.restore({
						id: 10 + goalNumber,
						sheetId: 100,
						goalNumber,
						challengeGoal: "目標",
					}),
				),
			}),
		);
		await expectResultError(
			use(milestones, sheets).execute(upsert(1, { challengeGoal: "x" }), out),
			{
				kind: "tooManyGoals",
				max: 2,
			},
		);
		expect(milestones.upsertText).not.toHaveBeenCalled();
	});
	it("does not read back after a failed score write, and fails when the sheet cannot be read", async () => {
		const failed = setup();
		failed.milestones.updateScore.mockRejectedValue(new Error("write failed"));
		await expect(
			use(failed.milestones, failed.sheets).execute(score(2, { firstScore: 2 }), failed.out),
		).rejects.toThrow("write failed");
		expect(failed.sheets.findById).toHaveBeenCalledTimes(1);
		expect(failed.out.present).not.toHaveBeenCalled();

		const lost = setup();
		lost.sheets.findById.mockResolvedValueOnce(sheet()).mockResolvedValueOnce(null);
		await expect(
			use(lost.milestones, lost.sheets).execute(score(2, { firstScore: 2 }), lost.out),
		).rejects.toThrow("読み込めませんでした");
		expect(lost.out.present).not.toHaveBeenCalled();
	});
	it.each(["update", "upsert"])("allows subject text %s on draft", async (mode) => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		const change = {
			challengeGoal: "new",
			periodGoals: [{ description: "mid", achievement: "" }],
		};
		await use(milestones, sheets).execute(
			mode === "update" ? text(change) : upsert(1, change),
			out,
		);
		expect(mode === "update" ? milestones.updateText : milestones.upsertText).toHaveBeenCalled();
	});
	it.each(["update", "upsert"])(
		"refuses new achievement text with a %s on draft, before the goals are confirmed",
		async (mode) => {
			const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
			const change = { periodGoals: [{ description: "手順を見直す", achievement: "書き足した" }] };
			await expectResultError(
				use(milestones, sheets).execute(mode === "update" ? text(change) : upsert(1, change), out),
				{ kind: "achievementBeforeConfirmation" },
			);
			expect(milestones.updateText).not.toHaveBeenCalled();
			expect(milestones.upsertText).not.toHaveBeenCalled();
		},
	);
	it("refuses achievements while the goals wait for confirmation", async () => {
		const { sheets, milestones, out } = setup(EvaluationStatus.GOALS_SUBMITTED);
		await expectResultError(
			use(milestones, sheets).execute(
				text({ periodGoals: [{ description: "手順を見直す", achievement: "書き足した" }] }),
				out,
			),
			{ kind: "forbidden", action: "editGoalText" },
		);
		expect(milestones.updateText).not.toHaveBeenCalled();
	});
	it("creates a goal by number only while the sheet has room", async () => {
		const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
		// 新しい目標は、保存後の読み直しに無いので「読み込めませんでした」になるが、書き込みは済んでいる
		await expect(
			use(milestones, sheets).execute(upsert(2, { challengeGoal: "" }), out),
		).rejects.toThrow("読み込めませんでした");
		expect(milestones.upsertText).toHaveBeenCalledWith(100, 2, "", [], "");

		const full = setup(EvaluationStatus.DRAFT);
		full.sheets.findById.mockResolvedValue(
			EvaluationSheet.create({ ...sheet(EvaluationStatus.DRAFT), maxObjectives: 1 }),
		);
		await expectResultError(
			use(full.milestones, full.sheets).execute(upsert(2, { challengeGoal: "x" }), full.out),
			{ kind: "goalNumberInvalid" },
		);
		full.sheets.findById.mockResolvedValue(
			EvaluationSheet.create({
				...sheet(EvaluationStatus.DRAFT),
				maxObjectives: 3,
				objectives: [
					milestone(),
					Milestone.restore({ id: 12, sheetId: 100, goalNumber: 2, challengeGoal: "目標2" }),
					Milestone.restore({ id: 13, sheetId: 100, goalNumber: 3, challengeGoal: "目標3" }),
				],
			}),
		);
		expect(
			await use(full.milestones, full.sheets).execute(upsert(3, { challengeGoal: "x" }), full.out),
		).toMatchObject({ ok: true, value: undefined });
		expect(full.milestones.upsertText).toHaveBeenCalledOnce();
	});
	// fixtures の目標 11 は、期中目標「手順を見直す」(達成状況「達成」)が1件
	it.each([
		[
			"changing a task",
			EvaluationStatus.GOALS_CONFIRMED,
			{ periodGoals: [{ description: "別", achievement: "" }] },
		],
		[
			"adding a task",
			EvaluationStatus.GOALS_CONFIRMED,
			{
				periodGoals: [
					{ description: "手順を見直す", achievement: "達成" },
					{ description: "追加", achievement: "" },
				],
			},
		],
		["changing the theme", EvaluationStatus.GOALS_CONFIRMED, { challengeGoal: "別のテーマ" }],
		["a theme achievement beside tasks", EvaluationStatus.DRAFT, { achievement: "テーマの実績" }],
		["a malformed task list", EvaluationStatus.DRAFT, { periodGoals: [null] as never }],
		[
			"anything once the achievements are submitted",
			EvaluationStatus.SUBMITTED,
			{ periodGoals: [{ description: "手順を見直す", achievement: "書き換え" }] },
		],
	] as const)("rejects %s without saving", async (_, status, change) => {
		const { sheets, milestones, out } = setup(status);
		expect((await use(milestones, sheets).execute(text(change), out)).ok).toBe(false);
		expect(milestones.updateText).not.toHaveBeenCalled();
		expect(milestones.upsertText).not.toHaveBeenCalled();
	});
	it.each([EvaluationStatus.GOALS_CONFIRMED])(
		"lets only the subject write the achievements in %s",
		async (status) => {
			const { sheets, milestones, out } = setup(status);
			await use(milestones, sheets).execute(
				text({
					challengeGoal: "目標",
					periodGoals: [{ description: "手順を見直す", achievement: "書き足した" }],
				}),
				out,
			);
			expect(milestones.updateText).toHaveBeenCalledWith(
				11,
				"目標",
				[{ description: "手順を見直す", achievement: "書き足した" }],
				"",
			);
			for (const id of [2, 3]) {
				await expectResultError(
					use(milestones, sheets).execute(text({ achievement: "x" }, 11, id), out),
					{ kind: "forbidden", action: "editGoalText" },
				);
			}
			// 確定後は、新しい目標を番号で作れない
			await expectResultError(
				use(milestones, sheets).execute(upsert(2, { achievement: "x" }), out),
				{ kind: "forbidden", action: "editGoalText" },
			);
			expect(milestones.upsertText).not.toHaveBeenCalled();
		},
	);
});

describe("common evaluation updates", () => {
	// 評価は 1〜4。配点(5)は係数なので、点数の上限ではない
	const result = { id: 21, itemId: 31, firstComment: "x", firstScore: 3, secondScore: 4 };
	it.each([
		[1, EvaluationStatus.SUBMITTED],
		[4, EvaluationStatus.SUBMITTED],
		// 段階が違えば、担当の評価者でも保存できない
		[2, EvaluationStatus.GOALS_SUBMITTED],
		[2, EvaluationStatus.FIRST_EVALUATED],
		[3, EvaluationStatus.SUBMITTED],
		[3, EvaluationStatus.FINALIZED],
	] as const)("denies %s at %s without saving", async (id, status) => {
		const { sheets, common, out } = setup(status);
		await expectResultError(
			new UpsertCommonEvaluationInteractor(sheets, common).execute(
				{ sheetId: 100, currentEmployeeId: id, results: [result] },
				out,
			),
			{ kind: "forbidden", action: "editCommonEvaluation" },
		);
		expect(common.upsertResults).not.toHaveBeenCalled();
	});
	it.each([2, 3])("passes least privilege flags for evaluator %s", async (id) => {
		const { sheets, common, out } = setup(stageOf(id));
		await new UpsertCommonEvaluationInteractor(sheets, common).execute(
			{ sheetId: 100, currentEmployeeId: id, results: [result] },
			out,
		);
		expect(common.upsertResults).toHaveBeenCalledWith(100, [result], id === 2, id === 3);
		expect(out.present).toHaveBeenCalledWith({ sheetId: 100, success: true });
	});
	it.each([
		["an item of another grade", [{ ...result, itemId: 999 }], "commonItemInvalid"],
		["the same item twice", [result, result], "commonItemInvalid"],
		["a score above 4", [{ ...result, firstScore: 6 }], "scoreOutOfRange"],
		["a score that is not a number", [{ ...result, firstScore: NaN }], "scoreOutOfRange"],
		["a fractional score", [{ ...result, firstScore: 2.5 }], "scoreOutOfRange"],
	] as const)("rejects %s before any write", async (_label, results, kind) => {
		const { sheets, common, out } = setup();
		expect(
			await new UpsertCommonEvaluationInteractor(sheets, common).execute(
				{ sheetId: 100, currentEmployeeId: 2, results: [...results] },
				out,
			),
		).toEqual({ ok: false, error: { kind } });
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
		await expectResultError(
			new UpdateOverallCommentInteractor(sheets, employees).execute(
				{ sheetId: 100, currentEmployeeId: id, target, comment: "x" },
				out,
			),
			{
				kind: "forbidden",
				action: target === "first" ? "editFirstOverallComment" : "editSecondOverallComment",
			},
		);
		expect(sheets.updateOverallComment).not.toHaveBeenCalled();
	});
	// 状態 6 × 操作する人(本人・一次・二次・無関係) × 進める先 6 のすべて。許されるのは状態遷移図の 6 本だけ
	const ALLOWED = new Set([
		"draft/1/goals_submitted",
		"goals_submitted/2/draft",
		"goals_submitted/2/goals_confirmed",
		"goals_confirmed/1/submitted",
		"submitted/2/first_evaluated",
		"first_evaluated/3/finalized",
	]);
	const everyTransition = EvaluationStatus.ALL.flatMap((initial) =>
		[1, 2, 3, 4].flatMap((id) =>
			EvaluationStatus.ALL.map((to) => [initial, id, to.toString()] as const),
		),
	);
	it.each(everyTransition.filter(([initial, id, to]) => ALLOWED.has(`${initial}/${id}/${to}`)))(
		"allows transition %s by %s to %s",
		async (initial, id, status) => {
			const { sheets, employees, out } = setup(initial);
			const notifications = notificationRepository();
			await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{
					sheetId: 100,
					currentEmployeeId: id,
					status: EvaluationStatus.from(status),
					returnReason: "理由",
				},
				out,
			);
			if (status === "draft") {
				expect(sheets.returnGoals).toHaveBeenCalledWith(100, expect.anything());
			} else {
				expect(sheets.updateStatus).toHaveBeenCalledWith(
					100,
					EvaluationStatus.from(status),
					expect.anything(),
				);
			}
			expect(notifications.notifySheetStatusChanged).toHaveBeenCalledTimes(
				status === "finalized" ? 0 : 1,
			);
			// 要修正で戻した評価者には、もう見られないシートの本文を返さない
			const presented = (vi.mocked(out.present).mock.calls[0][0] as { sheet: unknown }).sheet;
			expect(presented === null).toBe(status === "draft");
		},
	);
	it.each(everyTransition.filter(([initial, id, to]) => !ALLOWED.has(`${initial}/${id}/${to}`)))(
		"rejects transition %s by %s to %s before any write or notification",
		async (initial, id, status) => {
			const { sheets, employees, out } = setup(initial);
			const notifications = notificationRepository();
			await expectResultError(
				new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
					{
						sheetId: 100,
						currentEmployeeId: id,
						status: EvaluationStatus.from(status),
						returnReason: "理由",
					},
					out,
				),
				{ kind: "transitionForbidden", to: status },
			);
			expect(sheets.updateStatus).not.toHaveBeenCalled();
			expect(sheets.returnGoals).not.toHaveBeenCalled();
			expect(notifications.notifySheetStatusChanged).not.toHaveBeenCalled();
			expect(out.present).not.toHaveBeenCalled();
		},
	);
	it.each([
		[EvaluationStatus.DRAFT, 1, "goals_submitted"],
		[EvaluationStatus.SUBMITTED, 2, "first_evaluated"],
	] as const)(
		"asks for no mail after %s by %s to %s while the workspace notifies in the app",
		async (initial, id, status) => {
			const { sheets, employees, out } = setup(initial);
			const inApp = (next: EvaluationStatus) => sheet(next, undefined, false, false, false);
			sheets.findById.mockResolvedValue(inApp(initial));
			sheets.updateStatus.mockImplementation(async (_id, next) => inApp(next));
			const notifications = notificationRepository();
			const useCase = new UpdateEvaluationStatusInteractor(sheets, employees, notifications);
			await useCase.execute(
				{ sheetId: 100, currentEmployeeId: id, status: EvaluationStatus.from(status) },
				out,
			);
			expect(sheets.updateStatus).toHaveBeenCalled();
			await expectResultError(useCase.resendNotification(100, id, vi.fn()), {
				kind: "forbidden",
				action: "resendNotification",
			});
			expect(notifications.notifySheetStatusChanged).not.toHaveBeenCalled();
		},
	);
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
		const { sheets, employees, out } = setup(EvaluationStatus.SUBMITTED);
		const notifications = notificationRepository();
		sheets.updateStatus.mockRejectedValue(new Error("DB unavailable"));
		await expect(
			new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FIRST_EVALUATED },
				out,
			),
		).rejects.toThrow("DB unavailable");
		expect(notifications.notifySheetStatusChanged).not.toHaveBeenCalled();
		expect(out.present).not.toHaveBeenCalled();
	});
	it.each([
		[EvaluationStatus.DRAFT, 1, "goals_submitted", "一次評価者"],
		[EvaluationStatus.SUBMITTED, 2, "first_evaluated", "二次評価者"],
	] as const)(
		"notification failure does not undo the saved stage %s by %s to %s",
		async (initial, id, status, recipient) => {
			const { sheets, employees } = setup(initial);
			vi.spyOn(console, "error").mockImplementation(() => {});
			const notifications = {
				notifySheetStatusChanged: vi.fn().mockRejectedValue(new Error("SMTP unavailable")),
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
	it.each([null, "timeout", { code: 500 }])(
		"explains a failed notification in its own words when the failure says nothing (%o)",
		async (failure) => {
			const { sheets, employees } = setup(EvaluationStatus.DRAFT);
			vi.spyOn(console, "error").mockImplementation(() => {});
			const notifications = { notifySheetStatusChanged: vi.fn().mockRejectedValue(failure) };
			const out = { present: vi.fn(), presentNotificationDelivery: vi.fn() };
			await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
				{ sheetId: 100, currentEmployeeId: 1, status: EvaluationStatus.GOALS_SUBMITTED },
				out,
			);
			await vi.waitFor(() =>
				expect(out.presentNotificationDelivery).toHaveBeenCalledExactlyOnceWith({
					recipient: "一次評価者",
					error: "通知メールを送信できませんでした。",
				}),
			);
		},
	);
	it("presents the saved stage without waiting for mail, then each delivery as it finishes", async () => {
		const { sheets, employees } = setup(EvaluationStatus.SUBMITTED);
		let deliver!: () => void;
		const notifications = {
			notifySheetStatusChanged: vi.fn(
				(_notification: unknown, report: (delivery: { recipient: string }) => void) =>
					new Promise<void>((resolve) => {
						deliver = () => {
							report({ recipient: "二次（二次評価者）" });
							resolve();
						};
					}),
			),
		};
		const out = { present: vi.fn(), presentNotificationDelivery: vi.fn() };
		await new UpdateEvaluationStatusInteractor(sheets, employees, notifications).execute(
			{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FIRST_EVALUATED },
			out,
		);
		expect(out.present).toHaveBeenCalledOnce();
		expect(notifications.notifySheetStatusChanged).toHaveBeenCalledWith(
			expect.objectContaining({ primaryEvaluatorName: "一次", secondaryEvaluatorName: "二次" }),
			expect.any(Function),
		);
		expect(out.presentNotificationDelivery).not.toHaveBeenCalled();
		deliver();
		expect(out.presentNotificationDelivery).toHaveBeenCalledExactlyOnceWith({
			recipient: "二次（二次評価者）",
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
			expect(notifications.notifySheetStatusChanged).not.toHaveBeenCalled();
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
		await expectResultError(
			interactor.execute(
				{ sheetId: 100, currentEmployeeId: 3, status: EvaluationStatus.FINALIZED },
				out,
			),
			{ kind: "transitionForbidden", to: "finalized" },
		);
		// 一次評価者の確定がそのまま評価の確定になるので、「一次評価済み」の段は通らない
		await expectResultError(
			interactor.execute(
				{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FIRST_EVALUATED },
				out,
			),
			{ kind: "transitionForbidden", to: "first_evaluated" },
		);

		await interactor.execute(
			{ sheetId: 100, currentEmployeeId: 2, status: EvaluationStatus.FINALIZED },
			out,
		);
		// 集計と確定はDBが一つの処理で行い、事前の集計保存はしない。
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
	it.each(["comment", "status", "milestone", "common"])(
		"missing sheet fails closed for %s",
		async (kind) => {
			const { sheets, employees, milestones, common, out } = setup();
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
						return new UpdateMilestoneInteractor(milestones, sheets).execute(
							{ action: "delete", sheetId: 100, currentEmployeeId: 1, milestoneId: 11 },
							out,
						);
					default:
						return new UpsertCommonEvaluationInteractor(sheets, common).execute(
							{ sheetId: 100, currentEmployeeId: 2, results: [] },
							out,
						);
				}
			};
			expect(await run()).toMatchObject({ ok: false, error: { kind: "sheetNotFound" } });
			expect(out.present).not.toHaveBeenCalled();
		},
	);
});

it("rejects removing the last goal before writing", async () => {
	const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
	await expectResultError(
		new UpdateMilestoneInteractor(milestones, sheets).execute(
			{ action: "delete", sheetId: 100, currentEmployeeId: 1, milestoneId: 11 },
			out,
		),
		{ kind: "lastGoal" },
	);
	expect(milestones.delete).not.toHaveBeenCalled();
});
it.each([1, 2])("allows only the subject to delete a tab (%s)", async (employeeId) => {
	const { sheets, milestones, out } = setup(EvaluationStatus.DRAFT);
	sheets.findById.mockResolvedValue(
		EvaluationSheet.create({
			...sheet(EvaluationStatus.DRAFT),
			objectives: [
				milestone(),
				Milestone.restore({ ...milestone(), id: 12, goalNumber: 2, firstScore: 0, secondScore: 0 }),
			],
		}),
	);
	const result = new UpdateMilestoneInteractor(milestones, sheets).execute(
		{ action: "delete", sheetId: 100, currentEmployeeId: employeeId, milestoneId: 12 },
		out,
	);
	if (employeeId === 1) {
		await result;
		expect(milestones.delete).toHaveBeenCalledWith(12);
	} else {
		await expectResultError(result, { kind: "forbidden", action: "deleteGoal" });
		expect(milestones.delete).not.toHaveBeenCalled();
	}
});

describe("deliberate notification retry", () => {
	// 再送できるのは、いまの状態へシートを渡した人(EvaluationStatus.handoff の from)で、シートを見られる人だけ。
	// 要修正で下書きに戻した一次評価者は、もう下書きを見られない。評価の確定は誰にも知らせない
	const SENDER: Record<string, number | null> = {
		draft: null,
		goals_submitted: 1,
		goals_confirmed: 2,
		submitted: 1,
		first_evaluated: 2,
		finalized: null,
	};
	it.each(EvaluationStatus.ALL.flatMap((stage) => [1, 2, 3, 4].map((id) => [stage, id] as const)))(
		"at %s, lets %s resend only if they handed the sheet over",
		async (stage, id) => {
			const sheets = sheetRepository();
			sheets.findById.mockResolvedValue(sheet(stage));
			const mail = { notifySheetStatusChanged: vi.fn().mockResolvedValue(undefined) };
			const result = await new UpdateEvaluationStatusInteractor(
				sheets,
				employeeRepository(),
				mail,
			).resendNotification(100, id, vi.fn());
			const sender = SENDER[stage.toString()] === id;
			expect(result).toEqual(
				sender
					? { ok: true, value: undefined }
					: { ok: false, error: { kind: "forbidden", action: "resendNotification" } },
			);
			expect(mail.notifySheetStatusChanged).toHaveBeenCalledTimes(sender ? 1 : 0);
			expect(sheets.updateStatus).not.toHaveBeenCalled();
		},
	);
	it("refuses a resend for a sheet it cannot find", async () => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(null);
		const mail = { notifySheetStatusChanged: vi.fn() };
		expect(
			await new UpdateEvaluationStatusInteractor(
				sheets,
				employeeRepository(),
				mail,
			).resendNotification(100, 1, vi.fn()),
		).toMatchObject({ ok: false, error: { kind: "forbidden" } });
		expect(mail.notifySheetStatusChanged).not.toHaveBeenCalled();
	});
});
