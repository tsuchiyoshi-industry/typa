import { err, ok, type Result } from "../../domain/Result";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import type { MilestoneRepository } from "../../domain/repositories/MilestoneRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import {
	describeSheetAccessError,
	type SheetAccessError,
} from "../../domain/services/SheetAccessError";
import type { OutputPort } from "../ports/OutputPort";
import type { FallibleUseCase } from "../ports/UseCase";

export interface CarryOverGoalRequest {
	sheetId: number;
	currentEmployeeId: number;
	/** 前期のシートの目標(milestones の id)。 */
	previousGoalId: number;
}

export interface CarryOverGoalOutputPort extends OutputPort<{ goalNumber: number }> {}

export type CarryOverGoalError =
	| SheetAccessError
	| { kind: "previousGoalInvalid" }
	| { kind: "sheetNotFound" };

export function describeCarryOverGoalError(error: CarryOverGoalError): string {
	switch (error.kind) {
		case "previousGoalInvalid":
			return "前期の目標が不正です。";
		case "sheetNotFound":
			return "評価シートが見つかりません。";
		default:
			return describeSheetAccessError(error);
	}
}

/**
 * 前期のチャレンジ目標を、今期の下書きへ引き継ぐ(据え置く・見直す)。写すのはチャレンジ目標の文言だけ。
 * 前期の目標か、引き継ぎ済みでないか、上限を越えないかは DB の carry_over_goal が確かめる。
 */
export class CarryOverGoalInteractor
	implements FallibleUseCase<CarryOverGoalRequest, CarryOverGoalOutputPort, CarryOverGoalError>
{
	constructor(
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
		private readonly milestoneRepository: Pick<MilestoneRepository, "carryOver">,
	) {}

	async execute(
		request: CarryOverGoalRequest,
		outputPort: CarryOverGoalOutputPort,
	): Promise<Result<void, CarryOverGoalError>> {
		if (!Number.isSafeInteger(request.previousGoalId) || request.previousGoalId < 1) {
			return err({ kind: "previousGoalInvalid" });
		}
		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			return err({ kind: "sheetNotFound" });
		}
		const policy = EvaluationSheetAccessPolicy.for(request.currentEmployeeId, sheet);
		const open = policy.periodOpen();
		if (!open.ok) {
			return open;
		}
		if (!policy.canCarryOverGoal()) {
			return err({ kind: "forbidden", action: "carryOverGoal" });
		}
		const goalNumber = await this.milestoneRepository.carryOver(
			request.sheetId,
			request.previousGoalId,
		);
		outputPort.present({ goalNumber });
		return ok(undefined);
	}
}
