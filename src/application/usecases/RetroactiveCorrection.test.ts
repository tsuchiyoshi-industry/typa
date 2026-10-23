import { describe, expect, it, vi } from "vitest";
import { RetroactiveCorrectionController } from "../../adapter/controllers/RetroactiveCorrectionController";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import type { RetroactiveCorrection } from "../../domain/entities/RetroactiveCorrection";
import { SheetCorrection } from "../../domain/entities/SheetCorrection";
import type { EvaluationSheetOverviewRow } from "../../domain/repositories/EvaluationSheetRepository";
import type { SheetCorrectionRepository } from "../../domain/repositories/SheetCorrectionRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import {
	commonResult,
	employee,
	masterRepository,
	milestone,
	period,
	periodRepository,
	profile,
	sheet,
} from "../../test/fixtures";
import { toEvaluationSheetDto } from "../dtos/EvaluationSheetMapper";
import { toSheetExportDataDto } from "../dtos/ExportSheetMapper";
import { CorrectClosedSheetInteractor } from "./CorrectClosedSheetInteractor";

const closedSheet = () => sheet(EvaluationStatus.FINALIZED, undefined, true);
function setup(role = "Admin", target: EvaluationSheet = closedSheet()) {
	const employees = masterRepository();
	employees.findCurrentEmployeeProfile.mockResolvedValue(profile(role, 9));
	const corrections = {
		findClosedSheet: vi
			.fn<SheetCorrectionRepository["findClosedSheet"]>()
			.mockResolvedValue(target),
		record: vi.fn<SheetCorrectionRepository["record"]>().mockResolvedValue(1),
	};
	const controller = new RetroactiveCorrectionController(
		periodRepository(),
		{ findOverview: vi.fn() },
		corrections,
		new CorrectClosedSheetInteractor(corrections, employees),
	);
	return { corrections, controller };
}
const secondScoreTo3 = {
	sheetId: 100,
	changes: [{ target: "goal", targetId: 11, field: "second_score", value: "3" }],
	reason: "二次評価の転記ミス",
};

describe("correcting a closed sheet", () => {
	it("shows what would change, then records it only after confirmation", async () => {
		const { corrections, controller } = setup();
		expect(await controller.correct({ ...secondScoreTo3, confirmed: false })).toEqual({
			status: "ready",
			changes: [{ subject: "チャレンジ目標 1・二次評価", before: "4", after: "3" }],
		});
		expect(corrections.record).not.toHaveBeenCalled();

		expect(await controller.correct({ ...secondScoreTo3, confirmed: true })).toEqual({
			status: "corrected",
			message:
				"テスト社員さんの「テスト期間」のシートを 1 件修正しました。修正したことは、本人と評価者のシートに表示されます。",
		});
		const recorded = corrections.record.mock.calls[0][0] as RetroactiveCorrection;
		expect([recorded.sheetId, recorded.reason.toString(), recorded.changes[0].after]).toEqual([
			100,
			"二次評価の転記ミス",
			"3",
		]);
	});

	it.each(["Reviewer", "Employee"])("is for an Admin only (%s)", async (role) => {
		const { corrections, controller } = setup(role);
		expect(await controller.correct({ ...secondScoreTo3, confirmed: true })).toEqual({
			status: "rejected",
			message: "遡及処理を行えるのは Admin のみです。",
		});
		expect(corrections.findClosedSheet).not.toHaveBeenCalled();
		expect(corrections.record).not.toHaveBeenCalled();
	});

	it.each([
		[
			"a sheet of the period in progress",
			sheet(EvaluationStatus.FINALIZED),
			secondScoreTo3,
			"締め済みの評価期間のシートだけ",
		],
		["no reason", closedSheet(), { ...secondScoreTo3, reason: " " }, "修正の理由"],
		[
			"nothing changed",
			closedSheet(),
			{ ...secondScoreTo3, changes: [] },
			"修正する項目がありません。",
		],
		[
			"the value it already has",
			closedSheet(),
			{
				...secondScoreTo3,
				changes: [{ target: "goal", targetId: 11, field: "second_score", value: "4" }],
			},
			"今と同じ内容には修正できません。",
		],
	])("refuses %s without recording anything", async (_label, target, request, message) => {
		const { corrections, controller } = setup("Admin", target);
		const result = await controller.correct({ ...request, confirmed: true });
		expect(result).toMatchObject({ status: "rejected", message: expect.stringContaining(message) });
		expect(corrections.record).not.toHaveBeenCalled();
	});

	it("reports a sheet that could not be read, or a correction the database refused, instead of crashing", async () => {
		const { corrections, controller } = setup();
		corrections.findClosedSheet.mockRejectedValueOnce(new Error("Admin のみ操作できます。"));
		expect(await controller.correct({ ...secondScoreTo3, confirmed: false })).toEqual({
			status: "rejected",
			message: "Admin のみ操作できます。",
		});
		corrections.record.mockRejectedValueOnce(new Error("点数は 1〜4 で入力してください。"));
		expect(await controller.correct({ ...secondScoreTo3, confirmed: true })).toEqual({
			status: "rejected",
			message: "点数は 1〜4 で入力してください。",
		});
	});
});

describe("choosing what to correct", () => {
	it("offers only closed periods, and the sheets of the chosen one in employee number order", async () => {
		const { corrections } = setup();
		const row = (id: number, periodId: number, employeeNo: string) =>
			({
				id,
				periodId,
				employeeNo,
				employeeName: `社員${id}`,
				status: EvaluationStatus.FINALIZED,
			}) as EvaluationSheetOverviewRow;
		const controller = new RetroactiveCorrectionController(
			periodRepository(),
			{
				findOverview: vi
					.fn()
					.mockResolvedValue([row(3, 1, "E3"), row(2, 2, "E2"), row(1, 1, "E1")]),
			},
			corrections,
			{} as CorrectClosedSheetInteractor,
		);
		expect((await controller.closedPeriods()).map((p) => p.periodName)).toEqual(["前期"]);
		expect((await controller.sheets(1)).map((s) => s.employeeNo)).toEqual(["E1", "E3"]);
	});
});

describe("showing corrections on a sheet and in its PDF", () => {
	const corrected = (target: string, field: string) =>
		SheetCorrection.restore({
			id: field.length,
			target,
			field,
			goalNumber: 1,
			itemTitle: "共通項目",
			before: field.endsWith("score") ? "4" : "前の文",
			after: field.endsWith("score") ? "3" : "後の文",
			reason: "転記ミス",
			correctedAt: "2026-10-23T01:00:00Z",
		});
	const withCorrections = (status: EvaluationStatus) =>
		EvaluationSheet.create({
			sheetId: 100,
			subject: employee(),
			evaluationPeriod: period(false, true),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			objectives: [milestone()],
			commonEvaluationResults: [commonResult()],
			status,
			corrections: [corrected("goal", "achievement"), corrected("goal", "second_score")],
		});

	it("gives each viewer only the corrections of items they may see", () => {
		const target = withCorrections(EvaluationStatus.FINALIZED);
		const seenBy = (viewer: number) =>
			toEvaluationSheetDto(
				target,
				"等級",
				EvaluationSheetAccessPolicy.for(viewer, target),
			).corrections.map((c) => c.subject);
		expect(seenBy(1)).toEqual(["チャレンジ目標 1・達成状況", "チャレンジ目標 1・二次評価"]);
		expect(seenBy(2)).toEqual(["チャレンジ目標 1・達成状況"]);
		expect(seenBy(3)).toEqual(["チャレンジ目標 1・達成状況", "チャレンジ目標 1・二次評価"]);
	});

	it("prints corrections in the PDF, leaving out score corrections where scores are hidden", () => {
		expect(
			toSheetExportDataDto(withCorrections(EvaluationStatus.FINALIZED), "等級").corrections,
		).toEqual([
			"2026-10-23 チャレンジ目標 1・達成状況: 前の文 → 後の文(理由: 転記ミス)",
			"2026-10-23 チャレンジ目標 1・二次評価: 4 → 3(理由: 転記ミス)",
		]);
		expect(
			toSheetExportDataDto(withCorrections(EvaluationStatus.DRAFT), "等級").corrections,
		).toEqual(["2026-10-23 チャレンジ目標 1・達成状況: 前の文 → 後の文(理由: 転記ミス)"]);
	});

	it("keeps periods in progress out of the list of closed periods", () => {
		const open = EvaluationPeriod.restore({
			id: 5,
			termName: "今期",
			startDate: "2026-04-01",
			endDate: "2027-03-31",
			isActive: true,
		});
		expect(open.isClosed).toBe(false);
		expect(() => open.assertAllowsRetroactiveCorrection()).toThrow(
			"締め済みの評価期間のシートだけ",
		);
	});
});
