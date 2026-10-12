import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditKeepSignedIn } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateEmployeeKeepSignedInRequest {
	targetEmployeeNo: string;
	keepSignedIn: boolean;
}

export interface UpdateEmployeeKeepSignedInResponse {
	success: boolean;
	message: string;
}

export interface UpdateEmployeeKeepSignedInOutputPort
	extends OutputPort<UpdateEmployeeKeepSignedInResponse> {}

/** アプリを閉じた後もログインを残すかどうかを、社員ごとに切り替える。 */
export class UpdateEmployeeKeepSignedInInteractor
	implements UseCase<UpdateEmployeeKeepSignedInRequest, UpdateEmployeeKeepSignedInOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: UpdateEmployeeKeepSignedInRequest,
		outputPort: UpdateEmployeeKeepSignedInOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditKeepSignedIn(currentEmployee.role)) {
			outputPort.present({
				success: false,
				message: "ログイン状態の保持を変更する権限がありません。",
			});
			return;
		}

		const updated = targetEmployeeNo
			? await this.employeeMasterRepository.updateKeepSignedInByEmployeeNo(
					targetEmployeeNo,
					request.keepSignedIn,
				)
			: null;

		outputPort.present({
			success: updated !== null,
			message:
				updated === null
					? "ログイン状態の保持を変更できませんでした。"
					: request.keepSignedIn
						? `${updated.name}さんは、アプリを閉じてもログインしたままになります。次のログインから反映されます。`
						: `${updated.name}さんは、アプリを閉じるとログアウトします。次にアプリを開いたときから反映されます。`,
		});
	}
}
