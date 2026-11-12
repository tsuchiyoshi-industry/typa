import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import {
	checkRegistrationReset,
	describeEmployeeAdministrationError,
} from "../../domain/services/EmployeeAdministration";
import { canResetRegistrations } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface ResetEmployeeRegistrationRequest {
	targetEmployeeNo: string;
}

export interface ResetEmployeeRegistrationResponse {
	success: boolean;
	message: string;
}

export interface ResetEmployeeRegistrationOutputPort
	extends OutputPort<ResetEmployeeRegistrationResponse> {}

/**
 * 社員の登録を取り消す。社員の行と評価データは残し、ログイン用アカウントだけを削除して
 * 未登録に戻す(パスワードを忘れた、別人が登録してしまった、などのやり直し用)。
 */
export class ResetEmployeeRegistrationInteractor
	implements UseCase<ResetEmployeeRegistrationRequest, ResetEmployeeRegistrationOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: ResetEmployeeRegistrationRequest,
		outputPort: ResetEmployeeRegistrationOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canResetRegistrations(currentEmployee.role)) {
			outputPort.present({ success: false, message: "登録を取り消す権限がありません。" });
			return;
		}

		const everyone = await this.employeeMasterRepository.findAllEmployeeProfiles();
		const target = targetEmployeeNo
			? everyone.find((profile) => profile.employeeNo === targetEmployeeNo)
			: undefined;
		if (!target) {
			outputPort.present({ success: false, message: "対象社員が見つかりませんでした。" });
			return;
		}

		// 自分の登録・最後の Admin の登録は消さない(DB 関数も同じきまりで断る)
		const allowed = checkRegistrationReset(currentEmployee, target, everyone);
		if (!allowed.ok) {
			outputPort.present({
				success: false,
				message: describeEmployeeAdministrationError(allowed.error),
			});
			return;
		}

		const reset =
			await this.employeeMasterRepository.resetRegistrationByEmployeeNo(targetEmployeeNo);

		outputPort.present({
			success: reset,
			message: reset
				? `${target.name}さんの登録を取り消しました。本人が新規登録をやり直すと、再び利用できます。`
				: "登録の取り消しに失敗しました。",
		});
	}
}
