import type {
	EmployeeMasterRepository,
	NewEmployee,
} from "../../domain/repositories/EmployeeMasterRepository";
import {
	checkNewEmployee,
	describeEmployeeAdministrationError,
} from "../../domain/services/EmployeeAdministration";
import { canRunSetup } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export type PreRegisterEmployeeRequest = NewEmployee;

export interface PreRegisterEmployeeResponse {
	success: boolean;
	message: string;
}

export interface PreRegisterEmployeeOutputPort extends OutputPort<PreRegisterEmployeeResponse> {}

/**
 * 導入処理の「初期ユーザ」: ログイン用アカウントのない社員を社員マスタに足す。
 * 本人はこの後、Admin が発行した招待コードで新規登録する。同じ確認は DB 関数でも行う。
 */
export class PreRegisterEmployeeInteractor
	implements UseCase<PreRegisterEmployeeRequest, PreRegisterEmployeeOutputPort>
{
	constructor(private readonly employeeMasterRepository: EmployeeMasterRepository) {}

	async execute(
		request: PreRegisterEmployeeRequest,
		outputPort: PreRegisterEmployeeOutputPort,
	): Promise<void> {
		const fail = (message: string) => outputPort.present({ success: false, message });

		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canRunSetup(currentEmployee.role)) {
			fail("社員を仮登録する権限がありません。");
			return;
		}

		// 全角で打った数字・英字も、ログインに使える半角にそろえる
		const employeeNo = request.employeeNo.normalize("NFKC").trim();
		const name = request.name.trim();

		const [grades, employees] = await Promise.all([
			this.employeeMasterRepository.findGrades(),
			this.employeeMasterRepository.findAllEmployeeProfiles(),
		]);
		// 仮登録のきまりはドメインにある(DB 関数も同じきまりで断る)
		const allowed = checkNewEmployee({ ...request, employeeNo, name }, employees);
		if (!allowed.ok) {
			fail(describeEmployeeAdministrationError(allowed.error));
			return;
		}
		if (!grades.some((grade) => grade.id === request.gradeId)) {
			fail("等級を選んでください。");
			return;
		}

		const registered = await this.employeeMasterRepository.preRegisterEmployee({
			...request,
			employeeNo,
			name,
		});
		outputPort.present(
			registered
				? {
						success: true,
						message: `${name}さん(${employeeNo})を仮登録しました。社員マスタで招待コードを発行してください。`,
					}
				: { success: false, message: "仮登録できませんでした。" },
		);
	}
}
