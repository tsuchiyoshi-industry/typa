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
 */
export type SignInEmployeeResponse = {
	status: "signed_in" | "invalid_credentials" | "registration_incomplete";
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
		const { userId, error } = await this.authRepository.signInWithPassword(
			request.employeeNo,
			request.password,
		);
		if (error || !userId) {
			presenter.present({ status: "invalid_credentials" });
			return;
		}

		if (!(await this.employeeRepository.checkUserLinked(userId))) {
			// 社員に紐付かないセッションを残さない。新規登録をやり直すと続きから再開できる
			await this.authRepository.signOut();
			presenter.present({ status: "registration_incomplete" });
			return;
		}

		presenter.present({ status: "signed_in" });
	}
}
