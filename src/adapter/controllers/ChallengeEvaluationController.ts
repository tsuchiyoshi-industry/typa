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

	async upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<boolean> {
		if (sheetId <= 0) {
			this.presentUpdateError("評価シートIDを取得できないため、目標を保存できません。");
			return false;
		}

		try {
			await this.updateMilestoneUseCase.execute(
				{
					sheetId,
					goalNumber,
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
