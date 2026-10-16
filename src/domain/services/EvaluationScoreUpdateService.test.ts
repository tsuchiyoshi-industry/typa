import { describe, expect, it } from "vitest";
import { commonRepository, milestoneRepository, sheetRepository } from "../../test/fixtures";
import { EvaluationScoreUpdateService } from "./EvaluationScoreUpdateService";

describe("score update service failure boundaries", () => {
	it("does not overwrite totals with zero when the sheet read fails", async () => {
		const sheets = sheetRepository(),
			milestones = milestoneRepository();
		sheets.findById.mockRejectedValue(new Error("read failed"));
		await expect(
			new EvaluationScoreUpdateService(sheets, milestones, commonRepository()).updateObjectiveScore(
				100,
				11,
				2,
			),
		).rejects.toThrow("read failed");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it("saves the score and reads authoritative totals without a second write", async () => {
		const sheets = sheetRepository(),
			milestones = milestoneRepository();
		const saved = await new EvaluationScoreUpdateService(
			sheets,
			milestones,
			commonRepository(),
		).updateObjectiveScore(100, 11, 2);
		expect(milestones.updateScore).toHaveBeenCalledWith(11, 2, undefined);
		expect(milestones.updateScore.mock.invocationCallOrder[0]).toBeLessThan(
			sheets.findById.mock.invocationCallOrder[0],
		);
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
		expect(saved.sheetId).toBe(100);
	});
	it("does not recompute totals after failed objective write", async () => {
		const sheets = sheetRepository();
		const milestones = milestoneRepository();
		milestones.updateScore.mockRejectedValue(new Error("write failed"));
		await expect(
			new EvaluationScoreUpdateService(sheets, milestones, commonRepository()).updateObjectiveScore(
				100,
				11,
				2,
			),
		).rejects.toThrow("write failed");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});

	it("rejects a missing sheet after an objective save", async () => {
		const sheets = sheetRepository();
		sheets.findById.mockResolvedValue(null);
		await expect(
			new EvaluationScoreUpdateService(
				sheets,
				milestoneRepository(),
				commonRepository(),
			).updateObjectiveScore(100, 11, 2),
		).rejects.toThrow("Failed to load");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it("saves a common batch once, without writing or rereading provisional aggregates", async () => {
		const sheets = sheetRepository(),
			common = commonRepository();
		await new EvaluationScoreUpdateService(
			sheets,
			milestoneRepository(),
			common,
		).upsertCommonEvaluationResults(100, [], true, false);
		expect(common.upsertResults).toHaveBeenCalledOnce();
		expect(sheets.findById).not.toHaveBeenCalled();
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it("does not refresh totals after failed common batch", async () => {
		const sheets = sheetRepository();
		const common = commonRepository();
		common.upsertResults.mockRejectedValue(new Error("write failed"));
		await expect(
			new EvaluationScoreUpdateService(
				sheets,
				milestoneRepository(),
				common,
			).upsertCommonEvaluationResults(100, [], true, false),
		).rejects.toThrow("write failed");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
});
