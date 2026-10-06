import type {
	EmployeeMasterRepository,
	EvaluatorType,
} from "../../domain/repositories/EmployeeMasterRepository";
import { canEditEvaluators } from "../../domain/services/EmployeeMasterAccessService";
import type { AssignEvaluatorResultDto } from "../dtos/EmployeeMasterDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEmployeeEvaluatorRequest {
	targetEmployeeNo: string;
	/** null は「なし」の明示。指定できるのは二次評価者だけ(その場合は一次評価者が最終評価者になる)。 */
	evaluatorEmployeeNo: string | null;
	evaluatorType: EvaluatorType;
}

export interface UpdateEmployeeEvaluatorResponse extends AssignEvaluatorResultDto {}

export interface UpdateEmployeeEvaluatorOutputPort
	extends OutputPort<UpdateEmployeeEvaluatorResponse> {}

export class UpdateEmployeeEvaluatorInteractor
	implements UseCase<UpdateEmployeeEvaluatorRequest, UpdateEmployeeEvaluatorOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: UpdateEmployeeEvaluatorRequest,
		outputPort: UpdateEmployeeEvaluatorOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();
		const evaluatorEmployeeNo = request.evaluatorEmployeeNo?.trim() || null;
		const evaluatorLabel = request.evaluatorType === "primary" ? "一次評価者" : "二次評価者";

		if (!targetEmployeeNo || (!evaluatorEmployeeNo && request.evaluatorType === "primary")) {
			outputPort.present({
				success: false,
				message: "対象社員番号と評価者の社員番号を入力してください。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo,
			});
			return;
		}

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditEvaluators(currentEmployee.roleName)) {
			outputPort.present({
				success: false,
				message: "評価者を更新する権限がありません。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo,
			});
			return;
		}

		const target = await this.employeeMasterRepository.findByEmployeeNo(targetEmployeeNo);
		const evaluator = evaluatorEmployeeNo
			? await this.employeeMasterRepository.findByEmployeeNo(evaluatorEmployeeNo)
			: null;
		if (!target || (evaluatorEmployeeNo && !evaluator)) {
			outputPort.present({
				success: false,
				message: "対象社員または評価者が見つかりませんでした。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo,
			});
			return;
		}

		if (target.id === evaluator?.id) {
			outputPort.present({
				success: false,
				message: "自分自身を評価者として設定することはできません。",
				evaluatorType: request.evaluatorType,
				targetEmployeeNo,
			});
			return;
		}

		const updatedProfile = await this.employeeMasterRepository.updateEvaluatorByEmployeeNo(
			targetEmployeeNo,
			evaluatorEmployeeNo,
			request.evaluatorType,
		);

		outputPort.present({
			success: updatedProfile !== null,
			message:
				updatedProfile === null
					? "評価者の更新に失敗しました。"
					: evaluator
						? `${updatedProfile.name}さんの${evaluatorLabel}を${evaluator.name}さんに更新しました。`
						: `${updatedProfile.name}さんの二次評価者を「なし」にしました。一次評価者の評価がそのまま最終評価になります。`,
			evaluatorType: request.evaluatorType,
			targetEmployeeNo,
		});
	}
}
