import type {
	UpdateMilestoneInteractor,
	UpdateMilestoneOutputPort,
} from "../../application/usecases/UpdateMilestoneInteractor";

export class ChallengeEvaluationController {
	constructor(
		private readonly updateMilestoneUseCase: UpdateMilestoneInteractor,
		private readonly outputPort: UpdateMilestoneOutputPort,
		private readonly presentUpdateError: (message: string) => void,
	) {}

	async updateText(
		milestoneId: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<boolean> {
		try {
			await this.updateMilestoneUseCase.execute(
				{
					milestoneId,
					challengeGoal,
					midtermGoal,
					achievement,
				},
				this.outputPort,
			);
			return true;
		} catch (error) {
			this.presentUpdateError(error instanceof Error ? error.message : "更新に失敗しました");
			return false;
		}
	}

	async updateScore(
		milestoneId: number,
		firstScore?: number,
		secondScore?: number,
	): Promise<boolean> {
		try {
			await this.updateMilestoneUseCase.execute(
				{
					milestoneId,
					firstScore,
					secondScore,
				},
				this.outputPort,
			);
			return true;
		} catch (error) {
			this.presentUpdateError(error instanceof Error ? error.message : "更新に失敗しました");
			return false;
		}
	}
}
