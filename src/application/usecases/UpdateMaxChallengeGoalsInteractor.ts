import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import {
	isValidMaxChallengeGoals,
	MAX_CHALLENGE_GOALS_RANGE,
} from "../../domain/valueObjects/MaxChallengeGoals";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";
import type { UpdateEvaluationAllocationResponse } from "./UpdateEvaluationAllocationInteractor";

export interface UpdateMaxChallengeGoalsRequest {
	max: number;
}

/** チャレンジ目標の数の上限を変える。Admin だけが行える(DB側でも Admin 以外の更新は拒否する)。 */
export class UpdateMaxChallengeGoalsInteractor
	implements UseCase<UpdateMaxChallengeGoalsRequest, OutputPort<UpdateEvaluationAllocationResponse>>
{
	constructor(
		private readonly settingsRepository: EvaluationSettingsRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: UpdateMaxChallengeGoalsRequest,
		outputPort: OutputPort<UpdateEvaluationAllocationResponse>,
	): Promise<void> {
		const { min, max } = MAX_CHALLENGE_GOALS_RANGE;
		if (!isValidMaxChallengeGoals(request.max)) {
			outputPort.present({
				success: false,
				message: `目標の数の上限は ${min}〜${max} の整数で入力してください。`,
			});
			return;
		}
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			outputPort.present({ success: false, message: "設定を変更できるのは Admin のみです。" });
			return;
		}
		const saved = await this.settingsRepository.saveMaxChallengeGoals(request.max);
		outputPort.present({
			success: saved,
			message: saved
				? `チャレンジ目標の上限を ${request.max} 件にしました。`
				: "チャレンジ目標の上限を保存できませんでした。",
		});
	}
}
