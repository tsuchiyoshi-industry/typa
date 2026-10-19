import type {
	UpdateEvaluationAllocationInteractor,
	UpdateEvaluationAllocationResponse,
} from "../../application/usecases/UpdateEvaluationAllocationInteractor";
import type { UpdateMaxChallengeGoalsInteractor } from "../../application/usecases/UpdateMaxChallengeGoalsInteractor";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";

export interface EvaluationSettingsViewModel {
	/** チャレンジ目標の配点。 */
	objective: number;
	/** 共通評価の配点。 */
	common: number;
	/** 1枚のシートに置けるチャレンジ目標の数の上限。 */
	maxChallengeGoals: number;
	canEdit: boolean;
}

export class SettingsController {
	constructor(
		private readonly settingsRepository: EvaluationSettingsRepository,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
		private readonly updateAllocationUseCase: UpdateEvaluationAllocationInteractor,
		private readonly updateMaxChallengeGoalsUseCase: UpdateMaxChallengeGoalsInteractor,
	) {}

	loadAllocation() {
		return this.settingsRepository.findAllocation();
	}

	/** 配点は誰でも読める(ヘルプの説明にも使う)。変更できるかは権限で決まる。 */
	async load(): Promise<EvaluationSettingsViewModel> {
		const [allocation, maxChallengeGoals, currentEmployee] = await Promise.all([
			this.settingsRepository.findAllocation(),
			this.settingsRepository.findMaxChallengeGoals(),
			this.employeeMasterRepository.findCurrentEmployeeProfile(),
		]);
		return {
			objective: allocation.objective,
			common: allocation.common,
			maxChallengeGoals,
			canEdit: !!currentEmployee && canEditSettings(currentEmployee.role),
		};
	}

	async saveMaxChallengeGoals(max: number): Promise<UpdateEvaluationAllocationResponse> {
		let response: UpdateEvaluationAllocationResponse = {
			success: false,
			message: "チャレンジ目標の上限を保存できませんでした。",
		};
		try {
			await this.updateMaxChallengeGoalsUseCase.execute(
				{ max },
				{
					present: (result) => {
						response = result;
					},
				},
			);
		} catch (error) {
			console.error("Error saving the challenge goal limit:", error);
		}
		return response;
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
