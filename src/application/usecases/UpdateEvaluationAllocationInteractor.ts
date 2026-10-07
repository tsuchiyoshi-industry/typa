import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEvaluationAllocationRequest {
	/** チャレンジ目標の配点。 */
	objective: number;
	/** 共通評価の配点。 */
	common: number;
}

export interface UpdateEvaluationAllocationResponse {
	success: boolean;
	message: string;
}

/** 評価点の配点を変える。Admin だけが行える(DB側でも Admin 以外の更新は拒否する)。 */
export class UpdateEvaluationAllocationInteractor
	implements
		UseCase<UpdateEvaluationAllocationRequest, OutputPort<UpdateEvaluationAllocationResponse>>
{
	constructor(
		private readonly settingsRepository: EvaluationSettingsRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: UpdateEvaluationAllocationRequest,
		outputPort: OutputPort<UpdateEvaluationAllocationResponse>,
	): Promise<void> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			outputPort.present({ success: false, message: "設定を変更できるのは Admin のみです。" });
			return;
		}

		let allocation: EvaluationAllocation;
		try {
			allocation = EvaluationAllocation.of(request.objective, request.common);
		} catch (error) {
			outputPort.present({
				success: false,
				message: error instanceof Error ? error.message : "配点が正しくありません。",
			});
			return;
		}

		const saved = await this.settingsRepository.saveAllocation(allocation);
		outputPort.present({
			success: saved,
			message: saved
				? `配点を保存しました（チャレンジ目標 ${allocation.objective} 点 / 共通評価 ${allocation.common} 点）。`
				: "配点を保存できませんでした。",
		});
	}
}
