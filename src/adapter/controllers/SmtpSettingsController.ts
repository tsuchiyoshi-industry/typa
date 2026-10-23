import { messageOf } from "../../application/errorMessage";
import type {
	UpdateNotificationChannelInteractor,
	UpdateNotificationChannelResponse,
} from "../../application/usecases/UpdateNotificationChannelInteractor";
import type {
	UpdateSmtpSettingsInteractor,
	UpdateSmtpSettingsRequest,
	UpdateSmtpSettingsResponse,
} from "../../application/usecases/UpdateSmtpSettingsInteractor";
import type {
	SmtpSettingsSummary,
	WorkspaceSettingsRepository,
} from "../../domain/repositories/WorkspaceSettingsRepository";

/** 設定画面の「通知メール」。送信テストに成功した SMTP サーバーと送信元アドレスだけを保存する。 */
export class SmtpSettingsController {
	constructor(
		private readonly settingsRepository: Pick<WorkspaceSettingsRepository, "findSmtpSummary">,
		private readonly updateUseCase: UpdateSmtpSettingsInteractor,
		private readonly channelUseCase: UpdateNotificationChannelInteractor,
	) {}

	async chooseChannel(channel: string): Promise<UpdateNotificationChannelResponse> {
		let response = { success: false, message: "通知の方法を変更できませんでした。" };
		try {
			await this.channelUseCase.execute({ channel }, { present: (result) => (response = result) });
		} catch (error) {
			console.error("Error saving the notification channel:", error);
		}
		return response;
	}

	/** パスワードは読み出さない。Admin 以外は null。 */
	load(): Promise<SmtpSettingsSummary | null> {
		return this.settingsRepository.findSmtpSummary();
	}

	async save(request: UpdateSmtpSettingsRequest): Promise<UpdateSmtpSettingsResponse> {
		let response = { success: false, message: "通知メールの設定を保存できませんでした。" };
		try {
			await this.updateUseCase.execute(request, { present: (result) => (response = result) });
		} catch (error) {
			// 送信テストの失敗は、SMTP の応答を添えた理由が届く
			response.message = messageOf(error, response.message);
		}
		return response;
	}
}
