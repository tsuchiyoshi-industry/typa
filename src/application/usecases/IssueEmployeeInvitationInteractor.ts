import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canManageEmployeeAccess } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface IssueEmployeeInvitationRequest {
	targetEmployeeNo: string;
}

/** 発行した招待コード。平文を見られるのはこの応答だけなので、Admin が本人に個別に渡す。 */
export interface IssuedEmployeeInvitation {
	employeeNo: string;
	name: string;
	code: string;
	expiresAt: string;
}

export interface IssueEmployeeInvitationResponse {
	success: boolean;
	message: string;
	invitation: IssuedEmployeeInvitation | null;
}

export interface IssueEmployeeInvitationOutputPort
	extends OutputPort<IssueEmployeeInvitationResponse> {}

/** 未登録の社員に、本人だけが新規登録に使える招待コードを発行する。 */
export class IssueEmployeeInvitationInteractor
	implements UseCase<IssueEmployeeInvitationRequest, IssueEmployeeInvitationOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: IssueEmployeeInvitationRequest,
		outputPort: IssueEmployeeInvitationOutputPort,
	): Promise<void> {
		const targetEmployeeNo = request.targetEmployeeNo.trim();
		const fail = (message: string) =>
			outputPort.present({ success: false, message, invitation: null });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canManageEmployeeAccess(currentEmployee.role)) {
			fail("招待コードを発行する権限がありません。");
			return;
		}

		const target = targetEmployeeNo
			? await this.employeeMasterRepository.findByEmployeeNo(targetEmployeeNo)
			: null;
		if (!target) {
			fail("対象社員が見つかりませんでした。");
			return;
		}

		// 発行できる条件は DB 関数でも同じく確かめる
		if (!target.enabled) {
			fail(`${target.name}さんは利用停止中です。先に利用を再開してください。`);
			return;
		}
		if (target.registered) {
			fail(`${target.name}さんは登録済みです。`);
			return;
		}

		const invitation =
			await this.employeeMasterRepository.issueInvitationByEmployeeNo(targetEmployeeNo);
		if (!invitation) {
			fail("招待コードを発行できませんでした。");
			return;
		}

		outputPort.present({
			success: true,
			message: `${target.name}さんの招待コードを発行しました。`,
			invitation: { employeeNo: target.employeeNo, name: target.name, ...invitation },
		});
	}
}
