import { messageOf } from "../../application/errorMessage";
import type {
	UpdateMilestoneInteractor,
	UpdateMilestoneOutputPort,
} from "../../application/usecases/UpdateMilestoneInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type {
	MilestoneRepository,
	PreviousGoals,
} from "../../domain/repositories/MilestoneRepository";
import { requireCurrentEmployeeId } from "./currentEmployee";

export class ChallengeEvaluationController {
	constructor(
		private readonly updateMilestoneUseCase: UpdateMilestoneInteractor,
		private readonly outputPort: UpdateMilestoneOutputPort,
		private readonly presentUpdateError: (message: string) => void,
		private readonly employeeRepository: EmployeeRepository,
		private readonly previousGoalsRepository: Pick<
			MilestoneRepository,
			"findPreviousGoals" | "carryOver"
		>,
	) {}

	/** 前の評価期間の目標。前の評価期間のシートが無い、または読めなければ null(画面には何も出さない)。 */
	async loadPreviousGoals(sheetId: number): Promise<PreviousGoals | null> {
		try {
			return await this.previousGoalsRepository.findPreviousGoals(sheetId);
		} catch (error) {
			console.error("Error loading previous goals:", error);
			return null;
		}
	}

	/** 前の評価期間の目標を、この評価期間の下書きに引き継ぐ。引き継げなければ、その理由。 */
	async carryOver(sheetId: number, goalId: number): Promise<string | null> {
		try {
			await this.previousGoalsRepository.carryOver(sheetId, goalId);
			return null;
		} catch (error) {
			return messageOf(error, "目標を引き継げませんでした。");
		}
	}

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
			this.presentUpdateError(messageOf(error, "更新に失敗しました"));
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
			this.presentUpdateError(messageOf(error, "更新に失敗しました"));
			return false;
		}
	}

	async delete(sheetId: number, milestoneId: number): Promise<boolean> {
		const currentEmployeeId = await this.requireCurrentEmployeeId();
		if (currentEmployeeId === null) {
			return false;
		}
		try {
			await this.updateMilestoneUseCase.execute(
				{ sheetId, currentEmployeeId, milestoneId, delete: true },
				this.outputPort,
			);
			return true;
		} catch (error) {
			this.presentUpdateError(messageOf(error, "削除に失敗しました"));
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
			this.presentUpdateError(messageOf(error, "更新に失敗しました"));
			return false;
		}
	}
}
