import type {
	EmployeeMasterRepository,
	EvaluatorType,
} from "../../domain/repositories/EmployeeMasterRepository";
import { canAssignEvaluator } from "../../domain/services/EmployeeMasterAccessService";
import type { AssignEvaluatorResultDto } from "../dtos/EmployeeMasterDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface AssignEvaluatorRequest {
	employeeNo: string;
	evaluatorType: EvaluatorType;
}

export interface AssignEvaluatorResponse extends AssignEvaluatorResultDto {}

export interface AssignEvaluatorOutputPort extends OutputPort<AssignEvaluatorResponse> {}

export class AssignEvaluatorInteractor
	implements UseCase<AssignEvaluatorRequest, AssignEvaluatorOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: AssignEvaluatorRequest,
		outputPort: AssignEvaluatorOutputPort,
	): Promise<void> {
		const normalizedEmployeeNo = request.employeeNo.trim();
		if (!normalizedEmployeeNo) {
			outputPort.present({
				success: false,
				message: "社員番号を入力してください。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo: normalizedEmployeeNo,
			});
			return;
		}

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee) {
			outputPort.present({
				success: false,
				message: "ログイン中の社員情報を取得できませんでした。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo: normalizedEmployeeNo,
			});
			return;
		}

		if (!canAssignEvaluator(currentEmployee.roleName)) {
			outputPort.present({
				success: false,
				message: "部下の設定権限がありません。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo: normalizedEmployeeNo,
			});
			return;
		}

		const target = await this.employeeMasterRepository.findByEmployeeNo(normalizedEmployeeNo);
		if (!target) {
			outputPort.present({
				success: false,
				message: "対象社員が見つかりませんでした。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo: normalizedEmployeeNo,
			});
			return;
		}

		if (target.id === currentEmployee.id) {
			outputPort.present({
				success: false,
				message: "自分自身を部下として設定することはできません。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo: normalizedEmployeeNo,
			});
			return;
		}

		const updatedProfile = await this.employeeMasterRepository.assignEvaluatorByEmployeeNo(
			normalizedEmployeeNo,
			currentEmployee.id,
			request.evaluatorType,
		);

		outputPort.present({
			success: updatedProfile !== null,
			message:
				updatedProfile !== null
					? `${updatedProfile.name}さんの${request.evaluatorType === "primary" ? "一次評価者" : "二次評価者"}に設定しました。`
					: "評価者の設定に失敗しました。",
			evaluatorType: request.evaluatorType,
			targetEmployeeNo: normalizedEmployeeNo,
		});
	}
}
