import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditRoles } from "../../domain/services/EmployeeMasterAccessService";
import { EmployeeRole } from "../../domain/valueObjects/EmployeeRole";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEmployeeRoleRequest {
	targetEmployeeNo: string;
	roleName: string;
}

export interface UpdateEmployeeRoleResponse {
	success: boolean;
	message: string;
}

export interface UpdateEmployeeRoleOutputPort extends OutputPort<UpdateEmployeeRoleResponse> {}

/** TYPA の権限(Admin / Reviewer / Employee)を変える。Admin だけが行え、Admin を0人にはできない。 */
export class UpdateEmployeeRoleInteractor
	implements UseCase<UpdateEmployeeRoleRequest, UpdateEmployeeRoleOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: UpdateEmployeeRoleRequest,
		outputPort: UpdateEmployeeRoleOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditRoles(currentEmployee.role)) {
			outputPort.present({ success: false, message: "権限を変更できるのは Admin のみです。" });
			return;
		}

		const role = EmployeeRole.find(request.roleName);
		const profiles = await this.employeeMasterRepository.findAllEmployeeProfiles();
		const target = profiles.find((profile) => profile.employeeNo === targetEmployeeNo);
		if (!target || !role) {
			outputPort.present({ success: false, message: "対象社員または権限が見つかりませんでした。" });
			return;
		}

		// 最後の Admin を外すと、誰も権限を管理できなくなる(DB側でも同じ条件で拒否する)
		if (
			target.role.isAdmin() &&
			!role.isAdmin() &&
			!profiles.some((profile) => profile.role.isAdmin() && profile.id !== target.id)
		) {
			outputPort.present({
				success: false,
				message:
					"Admin が0名になるため変更できません。先に別の社員を Admin にしてから変更してください。",
			});
			return;
		}

		const updated = await this.employeeMasterRepository.updateRoleByEmployeeNo(
			targetEmployeeNo,
			role,
		);

		outputPort.present({
			success: updated,
			message: updated
				? `${target.name}さんの権限を ${role} に変更しました。`
				: "権限の変更に失敗しました。",
		});
	}
}
