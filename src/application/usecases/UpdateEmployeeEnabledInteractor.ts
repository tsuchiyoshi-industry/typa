import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
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

		// 自分を止めると、操作中のセッションごと使えなくなる
		if (target.id === currentEmployee.id && !request.enabled) {
			outputPort.present({ success: false, message: "自分自身の利用は停止できません。" });
			return;
		}

		// 最後の Admin を止めると、誰も権限を管理できなくなる(DB側でも同じ条件で拒否する)
		if (
			!request.enabled &&
			target.role.isAdmin() &&
			!profiles.some(
				(profile) =>
					profile.role.isAdmin() &&
					profile.registered &&
					profile.enabled &&
					profile.id !== target.id,
			)
		) {
			outputPort.present({
				success: false,
				message:
					"利用できる Admin が0名になるため停止できません。先に別の社員を Admin にしてください。",
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
