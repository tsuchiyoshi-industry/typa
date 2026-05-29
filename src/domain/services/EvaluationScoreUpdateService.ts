import type { Milestone } from "../entities/Milestone";
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

	async updateObjectiveScore(
		milestoneId: number,
		firstScore?: number,
		secondScore?: number,
	): Promise<Milestone> {
		const updated = await this.milestoneRepository.updateScore(
			milestoneId,
			firstScore,
			secondScore,
		);
		const objectives = await this.milestoneRepository.findBySheetId(updated.sheetId);
		const objectiveScoreTotals = EvaluationScoreTotals.fromObjectives(objectives);
		const sheet = await this.evaluationSheetRepository.findById(updated.sheetId);
		if (!sheet) {
			throw new Error("Failed to load evaluation sheet for score totals.");
		}

		await this.evaluationSheetRepository.updateScoreTotals(updated.sheetId, {
			objectives: objectiveScoreTotals,
			allocatedScores: EvaluationAllocatedScores.fromTotals(
				objectiveScoreTotals,
				sheet.commonEvaluationScoreTotals,
			),
		});

		return updated;
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
			),
		});
	}
}
