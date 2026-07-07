import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import type { EvaluationScoreUpdateService } from "../../domain/services/EvaluationScoreUpdateService";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { MilestoneDto } from "../dtos/MilestoneDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateMilestoneRequest {
	sheetId: number;
	currentEmployeeId: number;
	milestoneId?: number;
	goalNumber?: number;
	challengeGoal?: string;
	midtermGoal?: string;
	achievement?: string;
	firstScore?: number;
	secondScore?: number;
}

export interface UpdateMilestoneResponse {
	milestone: MilestoneDto;
}

export interface UpdateMilestoneOutputPort extends OutputPort<UpdateMilestoneResponse> {}

export class UpdateMilestoneInteractor
	implements UseCase<UpdateMilestoneRequest, UpdateMilestoneOutputPort>
{
	constructor(
		private readonly milestoneRepository: MilestoneRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly evaluationScoreUpdateService: EvaluationScoreUpdateService,
	) {}

	async execute(
		request: UpdateMilestoneRequest,
		outputPort: UpdateMilestoneOutputPort,
	): Promise<void> {
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);

		let updated = null;

		if (
			request.challengeGoal !== undefined ||
			request.midtermGoal !== undefined ||
			request.achievement !== undefined
		) {
			if (!policy.canEditMilestoneGoal()) {
				throw new Error("自分の評価シートの目標のみ編集できます。");
			}

			if (request.milestoneId !== undefined) {
				updated = await this.milestoneRepository.updateText(
					request.milestoneId,
					request.challengeGoal ?? "",
					request.midtermGoal ?? "",
					request.achievement ?? "",
				);
			} else if (request.goalNumber !== undefined) {
				updated = await this.milestoneRepository.upsertText(
					request.sheetId,
					request.goalNumber,
					request.challengeGoal ?? "",
					request.midtermGoal ?? "",
					request.achievement ?? "",
				);
			}
		}

		if (request.firstScore !== undefined || request.secondScore !== undefined) {
			if (request.milestoneId === undefined) {
				throw new Error("Milestone ID is required to update milestone score.");
			}
			if (request.firstScore !== undefined && !policy.canEditMilestoneFirstScore()) {
				throw new Error("一次評価者のみ一次評価を編集できます。");
			}
			if (request.secondScore !== undefined && !policy.canEditMilestoneSecondScore()) {
				throw new Error("二次評価者のみ二次評価を編集できます。");
			}
			updated = await this.evaluationScoreUpdateService.updateObjectiveScore(
				request.milestoneId,
				request.firstScore,
				request.secondScore,
			);
		}

		if (!updated) {
			throw new Error("No milestone changes were provided.");
		}

		const canViewSecondScore = policy.canViewMilestoneSecondScore();
		outputPort.present({
			milestone: {
				id: updated.id,
				sheetId: updated.sheetId,
				goalNumber: updated.goalNumber,
				challengeGoal: updated.challengeGoal,
				midtermGoal: updated.midtermGoal,
				achievement: updated.achievement,
				firstScore: updated.firstScore.toNumber(),
				secondScore: canViewSecondScore ? updated.secondScore.toNumber() : null,
			},
		});
	}
}
