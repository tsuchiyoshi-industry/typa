import type { EvaluationSheet } from "../entities/EvaluationSheet";
import type {
	CommonEvaluationRepository,
	CommonEvaluationResultPayload,
} from "../repositories/CommonEvaluationRepository";
import type { EvaluationSheetRepository } from "../repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../repositories/MilestoneRepository";

export class EvaluationScoreUpdateService {
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly milestoneRepository: MilestoneRepository,
		private readonly commonEvaluationRepository: CommonEvaluationRepository,
	) {}

	/** 目標の点数を保存し、表示用の集計を含むシートを読み直す。確定値の保存はDBが行う。 */
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
	}
}
