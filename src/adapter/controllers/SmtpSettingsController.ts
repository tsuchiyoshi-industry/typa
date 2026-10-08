import type {
	UpdateSmtpSettingsInteractor,
	UpdateSmtpSettingsRequest,
	UpdateSmtpSettingsResponse,
} from "../../application/usecases/UpdateSmtpSettingsInteractor";
import type {
	SmtpSettingsSummary,
	WorkspaceSettingsRepository,
} from "../../domain/repositories/WorkspaceSettingsRepository";

/** 設定画面の「通知メール」。送信に使う SMTP サーバーと送信元アドレス。 */
export class SmtpSettingsController {
	constructor(
		private readonly settingsRepository: Pick<WorkspaceSettingsRepository, "findSmtpSummary">,
		private readonly updateUseCase: UpdateSmtpSettingsInteractor,
	) {}

	/** パスワードは読み出さない。Admin 以外は null。 */
	load(): Promise<SmtpSettingsSummary | null> {
		return this.settingsRepository.findSmtpSummary();
	}

	async save(request: UpdateSmtpSettingsRequest): Promise<UpdateSmtpSettingsResponse> {
		let response = { success: false, message: "通知メールの設定を保存できませんでした。" };
		try {
			await this.updateUseCase.execute(request, { present: (result) => (response = result) });
		} catch (error) {
			console.error("Error saving SMTP settings:", error);
		}
		return response;
	}
}
