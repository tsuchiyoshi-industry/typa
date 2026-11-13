import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface SignInEmployeeRequest {
	employeeNo: string;
	password: string;
}

/**
 * invalid_credentials: 社員番号かパスワードが違う。
 * registration_incomplete: アカウントはあるが、社員番号の紐付けの前で登録が止まっている。
 * unavailable: 社員に紐付いているか、会社ドメインを確かめられなかった(通信の失敗など)。もう一度ログインしてもらう。
 * unconfigured: ログイン用アドレスの会社ドメインが未設定で、誰もログインできない。管理者が直す。
 * password_change_required: Admin が設定した仮のパスワード。セッションを残し、本人に新しいパスワードを決めてもらう。
 */
export type SignInEmployeeResponse = {
	status:
		| "signed_in"
		| "invalid_credentials"
		| "registration_incomplete"
		| "account_disabled"
		| "password_change_required"
		| "unavailable"
		| "unconfigured";
};

export type SignInEmployeeOutputPort = OutputPort<SignInEmployeeResponse>;

export class SignInEmployeeInteractor
	implements UseCase<SignInEmployeeRequest, SignInEmployeeOutputPort>
{
	constructor(
		private readonly authRepository: AuthRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: SignInEmployeeRequest,
		presenter: SignInEmployeeOutputPort,
	): Promise<void> {
		const { userId, error, reason } = await this.authRepository.signInWithPassword(
			request.employeeNo,
			request.password,
		);
		if (reason) {
			presenter.present({ status: reason });
			return;
		}
		if (error || !userId) {
			presenter.present({ status: "invalid_credentials" });
			return;
		}

		let linked: boolean;
		try {
			linked = await this.employeeRepository.checkUserLinked(userId);
		} catch {
			// 確かめられなかったことを「登録が終わっていない」と言わない。分からないセッションも残さない
			await this.authRepository.signOut();
			presenter.present({ status: "unavailable" });
			return;
		}
		if (!linked) {
			const access = await this.employeeRepository.findCurrentAccessState();
			if (access === "password_change_required") {
				// 仮のパスワードのままでは DB が何も読ませない。変えるまでの間だけセッションを残す
				presenter.present({ status: access });
				return;
			}
			// 社員に紐付かないセッションを残さない。新規登録をやり直すと続きから再開できる
			await this.authRepository.signOut();
			presenter.present({
				status: access === "disabled" ? "account_disabled" : "registration_incomplete",
			});
			return;
		}

		presenter.present({ status: "signed_in" });
	}
}
