import { describe, expect, it } from "vitest";
import { commonRepository, milestoneRepository, sheetRepository } from "../../test/fixtures";
import { EvaluationScoreUpdateService } from "./EvaluationScoreUpdateService";

describe("score update service failure boundaries", () => {
	it("does not overwrite totals with zero when objective read fails", async () => {
		const sheets = sheetRepository(),
			milestones = milestoneRepository();
		milestones.findBySheetId.mockRejectedValue(new Error("read failed"));
		await expect(
			new EvaluationScoreUpdateService(sheets, milestones, commonRepository()).updateObjectiveScore(
				11,
				2,
			),
		).rejects.toThrow("read failed");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it("does not recompute totals after failed objective write", async () => {
		const sheets = sheetRepository();
		const milestones = milestoneRepository();
		milestones.updateScore.mockRejectedValue(new Error("write failed"));
		await expect(
			new EvaluationScoreUpdateService(sheets, milestones, commonRepository()).updateObjectiveScore(
				11,
				2,
			),
		).rejects.toThrow("write failed");
		expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
	});
	it.each(["objective", "common"])(
		"rejects missing sheet during %s totals refresh",
		async (kind) => {
			const sheets = sheetRepository();
			sheets.findById.mockResolvedValue(null);
			const service = new EvaluationScoreUpdateService(
				sheets,
				milestoneRepository(),
				commonRepository(),
			);
			await expect(
				kind === "objective"
					? service.updateObjectiveScore(11, 2)
					: service.refreshCommonEvaluationTotals(100),
			).rejects.toThrow("Failed to load");
			expect(sheets.updateScoreTotals).not.toHaveBeenCalled();
		},
	);
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
