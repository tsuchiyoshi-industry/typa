import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import {
	checkPasswordReset,
	describeEmployeeAdministrationError,
	isUsableAdmin,
} from "../../domain/services/EmployeeAdministration";
import {
	ACCOUNT_PASSWORD_RULE,
	isValidAccountPassword,
} from "../../domain/valueObjects/AccountPassword";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface ResetEmployeePasswordRequest {
	targetEmployeeNo: string;
	password: string;
}
type Response = { success: boolean; message: string };

/**
 * パスワードを忘れた社員に、Admin が仮のパスワードを設定する。登録と評価データは残る。
 * 本人は最初のログインで自分のパスワードに変えるまで、何も読めない(DB が断る)。
 */
export class ResetEmployeePasswordInteractor
	implements UseCase<ResetEmployeePasswordRequest, OutputPort<Response>>
{
	constructor(private readonly employees: EmployeeMasterRepository) {}

	async execute(request: ResetEmployeePasswordRequest, out: OutputPort<Response>): Promise<void> {
		const refuse = (message: string) => out.present({ success: false, message });
		const operator = await this.employees.findCurrentEmployeeProfile();
		if (!operator || !isUsableAdmin(operator)) {
			return refuse("パスワードを再設定する権限がありません。");
		}
		if (!isValidAccountPassword(request.password)) {
			return refuse(`仮のパスワードは${ACCOUNT_PASSWORD_RULE}`);
		}
		const employeeNo = request.targetEmployeeNo.trim();
		const target = await this.employees.findByEmployeeNo(employeeNo);
		if (!target) {
			return refuse("社員が見つかりません。画面を読み込み直してください。");
		}
		const check = checkPasswordReset(operator, target);
		if (!check.ok) {
			return refuse(describeEmployeeAdministrationError(check.error));
		}
		if (!(await this.employees.resetPasswordByEmployeeNo(employeeNo, request.password))) {
			return refuse(
				"再設定できませんでした。画面を読み込み直して、社員の登録状態を確かめてください。",
			);
		}
		out.present({
			success: true,
			message: `${target.name}さんに仮のパスワードを設定しました。本人に直接伝えてください。本人は最初のログインで自分のパスワードに変えます。`,
		});
	}
}
