import { messageOf } from "../../application/errorMessage";
import type { CarryOverGoalInteractor } from "../../application/usecases/CarryOverGoalInteractor";
import { describeSheetEditError } from "../../application/usecases/SheetEditError";
import type {
	UpdateMilestoneInteractor,
	UpdateMilestoneOutputPort,
	UpdateMilestoneRequest,
} from "../../application/usecases/UpdateMilestoneInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type {
	MilestoneRepository,
	PreviousGoals,
} from "../../domain/repositories/MilestoneRepository";
import type { PeriodGoal } from "../../domain/valueObjects/PeriodGoal";
import { requireCurrentEmployeeId } from "./currentEmployee";

export class ChallengeEvaluationController {
	constructor(
		private readonly updateMilestoneUseCase: UpdateMilestoneInteractor,
		private readonly outputPort: UpdateMilestoneOutputPort,
		private readonly presentUpdateError: (message: string) => void,
		private readonly employeeRepository: EmployeeRepository,
		private readonly previousGoalsRepository: Pick<MilestoneRepository, "findPreviousGoals">,
		private readonly carryOverGoalUseCase: Pick<CarryOverGoalInteractor, "execute">,
	) {}

	/**
	 * 前期のチャレンジ目標を、今期の下書きへ引き継ぐ(据え置く・見直す)。
	 * 入れた先の目標番号か、引き継げなかった理由を返す。
	 */
	async carryOver(
		sheetId: number,
		previousGoalId: number,
	): Promise<{ goalNumber: number } | { error: string }> {
		const currentEmployeeId = await this.requireCurrentEmployeeId();
		if (currentEmployeeId === null) {
			return { error: "ログインが必要です。" };
		}
		let goalNumber: number | null = null;
		try {
			const result = await this.carryOverGoalUseCase.execute(
				{ sheetId, currentEmployeeId, previousGoalId },
				{ present: (response) => (goalNumber = response.goalNumber) },
			);
			if (!result.ok) {
				return { error: describeSheetEditError(result.error) };
			}
		} catch (error) {
			return { error: messageOf(error, "前期の目標を引き継げませんでした。") };
		}
		return goalNumber === null ? { error: "前期の目標を引き継げませんでした。" } : { goalNumber };
	}

	/** 前の評価期間の目標。前の評価期間のシートが無い、または読めなければ null(画面には何も出さない)。 */
	async loadPreviousGoals(sheetId: number): Promise<PreviousGoals | null> {
		try {
			return await this.previousGoalsRepository.findPreviousGoals(sheetId);
		} catch (error) {
			console.error("Error loading previous goals:", error);
			return null;
		}
	}

	private requireCurrentEmployeeId(): Promise<number | null> {
		return requireCurrentEmployeeId(this.employeeRepository, this.presentUpdateError);
	}

	/** 目標への操作を1つ行う。失敗の理由は画面に出し、false を返す。 */
	private async run(
		request: DistributiveOmit<UpdateMilestoneRequest, "currentEmployeeId">,
		failure: string,
	): Promise<boolean> {
		const currentEmployeeId = await this.requireCurrentEmployeeId();
		if (currentEmployeeId === null) {
			return false;
		}
		try {
			const result = await this.updateMilestoneUseCase.execute(
				{ ...request, currentEmployeeId } as UpdateMilestoneRequest,
				this.outputPort,
			);
			if (!result.ok) {
				this.presentUpdateError(describeSheetEditError(result.error));
				return false;
			}
			return true;
		} catch (error) {
			this.presentUpdateError(messageOf(error, failure));
			return false;
		}
	}

	updateText(
		sheetId: number,
		milestoneId: number,
		challengeGoal: string,
		periodGoals: readonly PeriodGoal[],
		achievement: string,
	): Promise<boolean> {
		return this.run(
			{ action: "text", sheetId, milestoneId, challengeGoal, periodGoals, achievement },
			"更新に失敗しました",
		);
	}

	async upsertText(
		sheetId: number,
		goalNumber: number,
		challengeGoal: string,
		periodGoals: readonly PeriodGoal[],
		achievement: string,
	): Promise<boolean> {
		if (sheetId <= 0) {
			this.presentUpdateError("評価シートIDを取得できないため、目標を保存できません。");
			return false;
		}
		return this.run(
			{ action: "upsertText", sheetId, goalNumber, challengeGoal, periodGoals, achievement },
			"更新に失敗しました",
		);
	}

	delete(sheetId: number, milestoneId: number): Promise<boolean> {
		return this.run({ action: "delete", sheetId, milestoneId }, "削除に失敗しました");
	}

	updateScore(
		sheetId: number,
		milestoneId: number,
		firstScore?: number,
		secondScore?: number,
	): Promise<boolean> {
		return this.run(
			{ action: "score", sheetId, milestoneId, firstScore, secondScore },
			"更新に失敗しました",
		);
	}
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
