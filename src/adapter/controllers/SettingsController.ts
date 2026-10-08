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
	/** 1枚のシートに置けるチャレンジ目標の数の上限。 */
	maxChallengeGoals: number;
	canEdit: boolean;
}

/** チャレンジ目標の数の上限として設定できる範囲(DB の制約と同じ)。 */
export const MAX_CHALLENGE_GOALS_RANGE = { min: 1, max: 10 } as const;

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

	/** Admin だけが変えられる(DB側でも Admin 以外の更新は拒否する)。 */
	async saveMaxChallengeGoals(max: number): Promise<UpdateEvaluationAllocationResponse> {
		const { min, max: upper } = MAX_CHALLENGE_GOALS_RANGE;
		if (!Number.isInteger(max) || max < min || max > upper) {
			return {
				success: false,
				message: `目標の数の上限は ${min}〜${upper} の整数で入力してください。`,
			};
		}
		try {
			const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
			if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
				return { success: false, message: "設定を変更できるのは Admin のみです。" };
			}
			if (await this.settingsRepository.saveMaxChallengeGoals(max)) {
				return { success: true, message: `チャレンジ目標の上限を ${max} 件にしました。` };
			}
		} catch (error) {
			console.error("Error saving the challenge goal limit:", error);
		}
		return { success: false, message: "チャレンジ目標の上限を保存できませんでした。" };
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
