import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface RegisterEmployeeAccountRequest {
	employeeNo: string;
	password: string;
	/** 認証コードを受け取ったメールアドレス。評価者への通知の宛先になる。 */
	email: string;
	/** まだ確認していない認証コード。確認が済んでいれば省く(認証コードは一度しか使えない)。 */
	verificationCode?: string;
}

/**
 * invalid_code: 認証コードが違うか、期限切れ。
 * employee_not_found / employee_registered: 社員マスタにない番号 / 登録済みの番号。
 * stalled_account: 前回の登録が紐付けの前で止まっていて、パスワードが前回と違う。
 * weak_password / signup_failed: アカウントを作れなかった。
 * link_failed: 社員番号の紐付けに失敗した。確認用セッションは破棄済みで、登録は最初からやり直す。
 */
export type RegisterEmployeeAccountResponse = {
	status:
		| "linked"
		| "invalid_code"
		| "employee_not_found"
		| "employee_registered"
		| "stalled_account"
		| "weak_password"
		| "signup_failed"
		| "link_failed";
};

export type RegisterEmployeeAccountOutputPort = OutputPort<RegisterEmployeeAccountResponse>;

/** 新規登録の2歩目: 認証コードと社員番号を確かめ、アカウントを作って社員に紐付ける。 */
export class RegisterEmployeeAccountInteractor
	implements UseCase<RegisterEmployeeAccountRequest, RegisterEmployeeAccountOutputPort>
{
	constructor(
		private readonly authRepository: AuthRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: RegisterEmployeeAccountRequest,
		presenter: RegisterEmployeeAccountOutputPort,
	): Promise<void> {
		if (request.verificationCode !== undefined) {
			const { error } = await this.authRepository.verifyEmailCode(
				request.email,
				request.verificationCode,
			);
			if (error) {
				presenter.present({ status: "invalid_code" });
				return;
			}
		}

		// 社員番号は管理者が社員マスタに登録した値。登録済みの番号は二重に使わせない
		const registration = await this.employeeRepository.findRegistrationStatus(request.employeeNo);
		if (registration !== "available") {
			presenter.present({
				status: registration === "registered" ? "employee_registered" : "employee_not_found",
			});
			return;
		}

		const account = await this.createAccount(request);
		if (account.status !== "created") {
			presenter.present({ status: account.status });
			return;
		}

		if (!(await this.employeeRepository.linkUserToEmployee(request.employeeNo, account.userId))) {
			await this.authRepository.signOut();
			presenter.present({ status: "link_failed" });
			return;
		}

		presenter.present({ status: "linked" });
	}

	private async createAccount(
		request: RegisterEmployeeAccountRequest,
	): Promise<
		| { status: "created"; userId: string }
		| { status: "stalled_account" | "weak_password" | "signup_failed" }
	> {
		const result = await this.authRepository.signUp(
			request.employeeNo,
			request.password,
			request.email,
		);
		if (result.status === "created") {
			return result;
		}
		if (result.status === "already_registered") {
			// 前回の登録が社員番号の紐付けの前で止まったアカウントは、同じパスワードなら続きから再開する
			const { userId } = await this.authRepository.signInWithPassword(
				request.employeeNo,
				request.password,
			);
			return userId ? { status: "created", userId } : { status: "stalled_account" };
		}
		return {
			status:
				(result.error as { code?: string }).code === "weak_password"
					? "weak_password"
					: "signup_failed",
		};
	}
}
