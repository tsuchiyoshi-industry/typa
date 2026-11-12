import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import {
	checkEnabledChange,
	describeEmployeeAdministrationError,
} from "../../domain/services/EmployeeAdministration";
import { canManageEmployeeAccess } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEmployeeEnabledRequest {
	targetEmployeeNo: string;
	enabled: boolean;
}

export interface UpdateEmployeeEnabledResponse {
	success: boolean;
	message: string;
}

export interface UpdateEmployeeEnabledOutputPort
	extends OutputPort<UpdateEmployeeEnabledResponse> {}

/**
 * 社員の利用を停止・再開する。停止すると閲覧・保存・新規登録ができなくなるが、
 * 評価データとアカウントは残る(登録の取り消しとは別)。
 */
export class UpdateEmployeeEnabledInteractor
	implements UseCase<UpdateEmployeeEnabledRequest, UpdateEmployeeEnabledOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: UpdateEmployeeEnabledRequest,
		outputPort: UpdateEmployeeEnabledOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();
		const action = request.enabled ? "再開" : "停止";

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canManageEmployeeAccess(currentEmployee.role)) {
			outputPort.present({ success: false, message: `利用を${action}する権限がありません。` });
			return;
		}

		const profiles = await this.employeeMasterRepository.findAllEmployeeProfiles();
		const target = profiles.find((profile) => profile.employeeNo === targetEmployeeNo);
		if (!target) {
			outputPort.present({ success: false, message: "対象社員が見つかりませんでした。" });
			return;
		}

		// 自分・最後の Admin は止めない(DB 関数も同じきまりで断る)
		const allowed = checkEnabledChange(currentEmployee, target, request.enabled, profiles);
		if (!allowed.ok) {
			outputPort.present({
				success: false,
				message: describeEmployeeAdministrationError(allowed.error),
			});
			return;
		}

		const updated = await this.employeeMasterRepository.updateEnabledByEmployeeNo(
			targetEmployeeNo,
			request.enabled,
		);

		outputPort.present({
			success: updated,
			message: updated
				? `${target.name}さんの利用を${action}しました。`
				: `利用の${action}に失敗しました。`,
		});
	}
}
