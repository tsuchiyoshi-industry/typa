import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type {
	CommonEvaluationRepository,
	CommonEvaluationResultPayload,
} from "../repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../repositories/MilestoneRepository";
import { EvaluationAllocatedScores } from "../valueObjects/EvaluationAllocatedScores";
import { EvaluationScoreTotals } from "../valueObjects/EvaluationScoreTotals";

export class EvaluationScoreUpdateService {
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly milestoneRepository: MilestoneRepository,
		private readonly commonEvaluationRepository: CommonEvaluationRepository,
	) {}

	/** 目標の点数を保存して集計を更新し、保存後の評価シートを返す。 */
	async updateObjectiveScore(
		sheetId: number,
		milestoneId: number,
		firstScore?: number,
		secondScore?: number,
	): Promise<EvaluationSheet> {
		await this.milestoneRepository.updateScore(milestoneId, firstScore, secondScore);
		const sheet = await this.evaluationSheetRepository.findById(sheetId);
		if (!sheet) {
			throw new Error("Failed to load evaluation sheet for score totals.");
		}
		const objectiveScoreTotals = EvaluationScoreTotals.fromObjectives(sheet.objectives);

		await this.evaluationSheetRepository.updateScoreTotals(sheetId, {
			objectives: objectiveScoreTotals,
			allocatedScores: EvaluationAllocatedScores.fromTotals(
				objectiveScoreTotals,
				sheet.commonEvaluationScoreTotals,
				sheet.primaryIsFinalEvaluator(),
				sheet.allocation,
			),
		});

		return sheet;
	}

	async upsertCommonEvaluationResults(
		sheetId: number,
		results: CommonEvaluationResultPayload[],
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<void> {
		await this.commonEvaluationRepository.upsertResults(
			sheetId,
			results,
			canEditFirst,
			canEditSecond,
		);
		await this.refreshCommonEvaluationTotals(sheetId);
	}

	async refreshCommonEvaluationTotals(sheetId: number): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(sheetId);
		if (!sheet) {
			throw new Error("Failed to load evaluation sheet for score totals.");
		}

		const commonEvaluationScoreTotals = EvaluationScoreTotals.fromCommonEvaluationResults(
			sheet.commonEvaluationResults,
		);

		await this.evaluationSheetRepository.updateScoreTotals(sheetId, {
			commonEvaluationResults: commonEvaluationScoreTotals,
			allocatedScores: EvaluationAllocatedScores.fromTotals(
				sheet.objectiveScoreTotals,
				commonEvaluationScoreTotals,
				sheet.primaryIsFinalEvaluator(),
				sheet.allocation,
			),
		});
	}
}
