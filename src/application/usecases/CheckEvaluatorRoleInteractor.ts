import { Employee } from "../../domain/entities/Employee";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import {
	isPrimaryEvaluator,
	isSecondaryEvaluator,
} from "../../domain/services/EvaluatorRoleService";
import type { EmployeeDto } from "../dtos/EmployeeDto";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface CheckEvaluatorRoleRequest {
	subject: EmployeeDto | null;
}

export interface CheckEvaluatorRoleResponse {
	canEditFirst: boolean;
	canEditSecond: boolean;
}

export interface CheckEvaluatorRoleOutputPort extends OutputPort<CheckEvaluatorRoleResponse> {}

export class CheckEvaluatorRoleInteractor
	implements UseCase<CheckEvaluatorRoleRequest, CheckEvaluatorRoleOutputPort>
{
	constructor(private readonly employeeRepository: EmployeeRepository) {}

	async execute(
		request: CheckEvaluatorRoleRequest,
		outputPort: CheckEvaluatorRoleOutputPort,
	): Promise<void> {
		const { subject: dto } = request;

		// 1. ガード句: 対象がいない場合は即座に終了
		if (!dto) {
			return outputPort.present({ canEditFirst: false, canEditSecond: false });
		}

		// 2. 現在のユーザー情報を取得
		const { data: currentEmployeeId, error } =
			await this.employeeRepository.findCurrentEmployeeId();

		// エラーハンドリング
		if (error || currentEmployeeId === null) {
			console.error("権限チェック中にエラーが発生しました:", error);
			return outputPort.present({ canEditFirst: false, canEditSecond: false });
		}

		// 3. DTO から エンティティ を再構成
		// ※ Employee クラスのコンストラクタ引数の順序に合わせてください
		const subjectEntity = new Employee(
			dto.id,
			dto.name,
			dto.employeeNo,
			dto.roleId,
			dto.careerCourse,
			dto.gradeId,
			dto.primaryEvaluatorId,
			dto.secondaryEvaluatorId,
		);

		// 4. ドメインサービスにエンティティを渡して判定
		const canEditFirst = isPrimaryEvaluator(currentEmployeeId, subjectEntity);
		const canEditSecond = isSecondaryEvaluator(currentEmployeeId, subjectEntity);

		outputPort.present({ canEditFirst, canEditSecond });
	}
}
