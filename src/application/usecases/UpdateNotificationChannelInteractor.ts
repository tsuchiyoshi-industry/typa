import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import type { WorkspaceSettingsRepository } from "../../domain/repositories/WorkspaceSettingsRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateNotificationChannelRequest {
	channel: string;
}

export interface UpdateNotificationChannelResponse {
	success: boolean;
	message: string;
}

/** 評価の依頼を知らせる方法(アプリ内通知かメール)を選ぶ。Admin だけが行える。 */
export class UpdateNotificationChannelInteractor
	implements
		UseCase<UpdateNotificationChannelRequest, OutputPort<UpdateNotificationChannelResponse>>
{
	constructor(
		private readonly settingsRepository: Pick<
			WorkspaceSettingsRepository,
			"saveNotificationChannel"
		>,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: UpdateNotificationChannelRequest,
		outputPort: OutputPort<UpdateNotificationChannelResponse>,
	): Promise<void> {
		const refuse = (message: string) => outputPort.present({ success: false, message });
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee?.enabled || !canEditSettings(currentEmployee.role)) {
			return refuse("設定を変更できるのは Admin のみです。");
		}
		const channel = request.channel;
		if (channel !== "in_app" && channel !== "email") {
			return refuse("通知の方法を選んでください。");
		}
		let saved: boolean;
		try {
			saved = await this.settingsRepository.saveNotificationChannel(channel);
		} catch (error) {
			if ((error as { code?: unknown } | null)?.code === "23514") {
				return refuse("メールは、送信テストに成功した通知メールの設定を保存してから選べます。");
			}
			throw error;
		}
		if (!saved) {
			return refuse("通知の方法を変更できませんでした。");
		}
		outputPort.present({
			success: true,
			message: `評価の依頼を${channel === "email" ? "メール" : "アプリ内通知"}で知らせます。`,
		});
	}
}
