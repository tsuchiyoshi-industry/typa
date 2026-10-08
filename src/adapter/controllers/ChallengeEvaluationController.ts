import type {
	UpdateMilestoneInteractor,
	UpdateMilestoneOutputPort,
} from "../../application/usecases/UpdateMilestoneInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import { requireCurrentEmployeeId } from "./currentEmployee";

export class ChallengeEvaluationController {
	constructor(
		private readonly updateMilestoneUseCase: UpdateMilestoneInteractor,
		private readonly outputPort: UpdateMilestoneOutputPort,
		private readonly presentUpdateError: (message: string) => void,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	private requireCurrentEmployeeId(): Promise<number | null> {
		return requireCurrentEmployeeId(this.employeeRepository, this.presentUpdateError);
	}

	async updateText(
		sheetId: number,
		milestoneId: number,
		challengeGoal: string,
		midtermGoal: string,
		achievement: string,
	): Promise<boolean> {
		const currentEmployeeId = await this.requireCurrentEmployeeId();
		if (currentEmployeeId === null) {
			return false;
		}

		try {
			await this.updateMilestoneUseCase.execute(
				{
					sheetId,
					currentEmployeeId,
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

		const currentEmployeeId = await this.requireCurrentEmployeeId();
		if (currentEmployeeId === null) {
			return false;
		}

		try {
			await this.updateMilestoneUseCase.execute(
				{
					sheetId,
					currentEmployeeId,
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
		sheetId: number,
		milestoneId: number,
		firstScore?: number,
		secondScore?: number,
	): Promise<boolean> {
		const currentEmployeeId = await this.requireCurrentEmployeeId();
		if (currentEmployeeId === null) {
			return false;
		}

		try {
			await this.updateMilestoneUseCase.execute(
				{
					sheetId,
					currentEmployeeId,
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
