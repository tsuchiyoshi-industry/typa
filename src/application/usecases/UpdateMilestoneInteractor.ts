import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import type { MilestoneDto } from "../dtos/MilestoneDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateMilestoneRequest {
	milestoneId: number;
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
	constructor(private readonly milestoneRepository: MilestoneRepository) {}

	async execute(
		request: UpdateMilestoneRequest,
		outputPort: UpdateMilestoneOutputPort,
	): Promise<void> {
		let updated = null;

		if (
			request.challengeGoal !== undefined ||
			request.midtermGoal !== undefined ||
			request.achievement !== undefined
		) {
			updated = await this.milestoneRepository.updateText(
				request.milestoneId,
				request.challengeGoal ?? "",
				request.midtermGoal ?? "",
				request.achievement ?? "",
			);
		}

		if (request.firstScore !== undefined || request.secondScore !== undefined) {
			updated = await this.milestoneRepository.updateScore(
				request.milestoneId,
				request.firstScore,
				request.secondScore,
			);
		}

		if (!updated) {
			throw new Error("No milestone changes were provided.");
		}

		outputPort.present({
			milestone: {
				id: updated.id,
				sheetId: updated.sheetId,
				goalNumber: updated.goalNumber,
				challengeGoal: updated.challengeGoal,
				midtermGoal: updated.midtermGoal,
				achievement: updated.achievement,
				firstScore: updated.firstScore.toNumber(),
				secondScore: updated.secondScore.toNumber(),
				isEditable: updated.isEditable,
			},
		});
	}
}
