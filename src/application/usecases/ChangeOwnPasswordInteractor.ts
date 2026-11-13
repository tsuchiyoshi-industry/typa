import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import { isValidAccountPassword } from "../../domain/valueObjects/AccountPassword";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

/**
 * changed: 変わり、DB も社員として扱うようになった。
 * weak_password / same_password: 条件を満たさない・仮のパスワードと同じ。入力し直してもらう。
 * failed: Auth が受け付けなかった(セッション切れ・通信)。unavailable: 変わったが、使えるかを確かめられなかった。
 */
export type ChangeOwnPasswordResponse = {
	status: "changed" | "weak_password" | "same_password" | "failed" | "unavailable";
};

/**
 * Admin が設定した仮のパスワードでログインした本人が、自分のパスワードに変える。
 * 変えると DB のトリガーが仮パスワードの印を外し、評価のデータを読めるようになる。
 */
export class ChangeOwnPasswordInteractor
	implements UseCase<{ password: string }, OutputPort<ChangeOwnPasswordResponse>>
{
	constructor(
		private readonly authRepository: AuthRepository,
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async execute(
		request: { password: string },
		presenter: OutputPort<ChangeOwnPasswordResponse>,
	): Promise<void> {
		if (!isValidAccountPassword(request.password)) {
			presenter.present({ status: "weak_password" });
			return;
		}
		const { error, reason } = await this.authRepository.changePassword(request.password);
		if (error) {
			presenter.present({ status: reason ?? "failed" });
			return;
		}
		const session = await this.authRepository.getSession();
		const linked = session
			? await this.employeeRepository.checkUserLinked(session.userId).catch(() => false)
			: false;
		presenter.present({ status: linked ? "changed" : "unavailable" });
	}
}
