import type {
	UpdateEvaluationAllocationInteractor,
	UpdateEvaluationAllocationResponse,
} from "../../application/usecases/UpdateEvaluationAllocationInteractor";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";

export interface EvaluationSettingsViewModel {
	/** チャレンジ目標の配点。 */
	objective: number;
	/** 共通評価の配点。 */
	common: number;
	canEdit: boolean;
}

export class SettingsController {
	constructor(
		private readonly settingsRepository: EvaluationSettingsRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
		private readonly updateAllocationUseCase: UpdateEvaluationAllocationInteractor,
	) {}

	loadAllocation() {
		return this.settingsRepository.findAllocation();
	}

	/** 配点は誰でも読める(ヘルプの説明にも使う)。変更できるかは権限で決まる。 */
	async load(): Promise<EvaluationSettingsViewModel> {
		const [allocation, currentEmployee] = await Promise.all([
			this.settingsRepository.findAllocation(),
			this.employeeMasterRepository.findCurrentEmployeeProfile(),
		]);
		return {
			objective: allocation.objective,
			common: allocation.common,
			canEdit: !!currentEmployee && canEditSettings(currentEmployee.role),
		};
	}

	async saveAllocation(
		objective: number,
		common: number,
	): Promise<UpdateEvaluationAllocationResponse> {
		let response: UpdateEvaluationAllocationResponse = {
			success: false,
			message: "配点を保存できませんでした。",
		};
		try {
			await this.updateAllocationUseCase.execute(
				{ objective, common },
				{
					present: (result) => {
						response = result;
					},
				},
			);
		} catch (error) {
			console.error("Error saving evaluation settings:", error);
		}
		return response;
	}
}
