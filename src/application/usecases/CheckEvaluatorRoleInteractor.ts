import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSheetRepository } from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationSheetAccessPolicy } from "../../domain/services/EvaluationSheetAccessPolicy";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CheckEvaluatorRoleRequest {
	sheetId: number | null;
}

export interface CheckEvaluatorRoleResponse {
	isSubject: boolean;
	canEditFirst: boolean;
	canEditSecond: boolean;
	canEditMilestoneGoal: boolean;
	canViewCommonEvaluation: boolean;
	canViewSecondEvaluation: boolean;
	canSubmitOwnSheet: boolean;
	canRevertOwnSheetToDraft: boolean;
	canFinalizeAsSecondaryEvaluator: boolean;
}

export interface CheckEvaluatorRoleOutputPort extends OutputPort<CheckEvaluatorRoleResponse> {}

const NO_PERMISSIONS: CheckEvaluatorRoleResponse = {
	isSubject: false,
	canEditFirst: false,
	canEditSecond: false,
	canEditMilestoneGoal: false,
	canViewCommonEvaluation: false,
	canViewSecondEvaluation: false,
	canSubmitOwnSheet: false,
	canRevertOwnSheetToDraft: false,
	canFinalizeAsSecondaryEvaluator: false,
};

export class CheckEvaluatorRoleInteractor
	implements UseCase<CheckEvaluatorRoleRequest, CheckEvaluatorRoleOutputPort>
{
	constructor(
		private readonly employeeRepository: EmployeeRepository,
		private readonly evaluationSheetRepository: EvaluationSheetRepository,
	) {}

	async execute(
		request: CheckEvaluatorRoleRequest,
		outputPort: CheckEvaluatorRoleOutputPort,
	): Promise<void> {
		if (request.sheetId === null) {
			return outputPort.present(NO_PERMISSIONS);
		}

		const sheet = await this.evaluationSheetRepository.findById(request.sheetId);
		if (!sheet) {
			return outputPort.present(NO_PERMISSIONS);
		}

		const { data: currentEmployeeId, error } =
			await this.employeeRepository.findCurrentEmployeeId();
		if (error || currentEmployeeId === null) {
			console.error("権限チェック中にエラーが発生しました:", error);
			return outputPort.present(NO_PERMISSIONS);
		}

		const policy = EvaluationSheetAccessPolicy.for(currentEmployeeId, sheet);

		outputPort.present({
			isSubject: policy.isSubject(),
			canEditFirst: policy.canEditCommonEvaluationFirst(),
			canEditSecond: policy.canEditCommonEvaluationSecond(),
			canEditMilestoneGoal: policy.canEditMilestoneGoal(),
			canViewCommonEvaluation: policy.canViewCommonEvaluation(),
			canViewSecondEvaluation: policy.canViewCommonEvaluationSecond(),
			canSubmitOwnSheet: policy.canSubmitOwnSheet(),
			canRevertOwnSheetToDraft: policy.canRevertOwnSheetToDraft(),
			canFinalizeAsSecondaryEvaluator: policy.canFinalizeAsSecondaryEvaluator(),
		});
	}
}
