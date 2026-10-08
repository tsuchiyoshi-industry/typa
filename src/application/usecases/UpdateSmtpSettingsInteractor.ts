import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { WorkspaceSettingsRepository } from "../../domain/repositories/WorkspaceSettingsRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateSmtpSettingsRequest {
	host: string;
	port: number;
	/** 送信元メールアドレス。SMTP のログインにも使う。 */
	user: string;
	/** 空なら、登録済みのパスワードを残す。 */
	password: string;
}

export interface UpdateSmtpSettingsResponse {
	success: boolean;
	message: string;
}

/** 通知メールの送信に使う SMTP 設定を変える。Admin だけが行える(DB側でも Admin 以外の更新は拒否する)。 */
export class UpdateSmtpSettingsInteractor
	implements UseCase<UpdateSmtpSettingsRequest, OutputPort<UpdateSmtpSettingsResponse>>
{
	constructor(
		private readonly settingsRepository: Pick<WorkspaceSettingsRepository, "saveSmtp">,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: UpdateSmtpSettingsRequest,
		outputPort: OutputPort<UpdateSmtpSettingsResponse>,
	): Promise<void> {
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee || !canEditSettings(currentEmployee.role)) {
			outputPort.present({ success: false, message: "設定を変更できるのは Admin のみです。" });
			return;
		}

		const host = request.host.trim();
		const user = request.user.trim();
		const invalid =
			!host || /\s/.test(host)
				? "SMTP ホストを入力してください。"
				: !Number.isInteger(request.port) || request.port < 1 || request.port > 65535
					? "ポートは 1〜65535 の整数で入力してください。"
					: !/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(user)
						? "送信元メールアドレスを正しく入力してください。"
						: null;
		if (invalid) {
			outputPort.present({ success: false, message: invalid });
			return;
		}

		const saved = await this.settingsRepository.saveSmtp({
			host,
			port: request.port,
			user,
			password: request.password,
		});
		outputPort.present({
			success: saved,
			message: saved
				? `通知メールの設定を保存しました（送信元 ${user}）。`
				: "通知メールの設定を保存できませんでした。",
		});
	}
}
