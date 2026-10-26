import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CarryOverGoalRequest {
	sheetId: number;
	currentEmployeeId: number;
	/** 前期のシートの目標(milestones の id)。 */
	previousGoalId: number;
}

export interface CarryOverGoalOutputPort extends OutputPort<{ goalNumber: number }> {}

/**
 * 前期のチャレンジ目標を、今期の下書きへ引き継ぐ(据え置く・見直す)。写すのはチャレンジ目標の文言だけ。
 * 前期の目標か、引き継ぎ済みでないか、上限を越えないかは DB の carry_over_goal が確かめる。
 */
export class CarryOverGoalInteractor
	implements UseCase<CarryOverGoalRequest, CarryOverGoalOutputPort>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly milestoneRepository: Pick<MilestoneRepository, "carryOver">,
	) {}

	async execute(request: CarryOverGoalRequest, outputPort: CarryOverGoalOutputPort): Promise<void> {
		if (!Number.isSafeInteger(request.previousGoalId) || request.previousGoalId < 1) {
			throw new Error("前期の目標が不正です。");
		}
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			throw new Error("評価シートが見つかりません。");
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		policy.assertPeriodOpen();
		if (!policy.canCarryOverGoal()) {
			throw new Error("前期の目標を引き継げるのは、本人の下書きの評価シートだけです。");
		}
		const goalNumber = await this.milestoneRepository.carryOver(
			request.sheetId,
			request.previousGoalId,
		);
		outputPort.present({ goalNumber });
	}
}
