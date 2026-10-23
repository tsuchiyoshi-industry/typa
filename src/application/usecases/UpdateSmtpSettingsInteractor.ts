import { normalizeEmailAddress } from "../../../supabase/functions/_shared/emailAddress";
import { isNotificationTemplateId } from "../../../supabase/functions/_shared/notificationTemplates";
import { smtpSettingsProblem } from "../../../supabase/functions/_shared/smtpSettings";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { NotificationTestGateway } from "../ports/NotificationTestGateway";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface UpdateSmtpSettingsRequest {
	host: string;
	port: number;
	/** 送信元メールアドレス。SMTP のログインにも使う。 */
	user: string;
	/** 空なら、登録済みのパスワードを残す。 */
	password: string;
	/** 送信テストの宛先。保存しない。 */
	to: string;
	/** 送信テストに使う通知パターン。 */
	templateId: string;
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
		private readonly gateway: Pick<NotificationTestGateway, "saveAfterTestMail">,
		private readonly employeeMasterRepository: EmployeeMasterRepository,
	) {}

	async execute(
		request: UpdateSmtpSettingsRequest,
		outputPort: OutputPort<UpdateSmtpSettingsResponse>,
	): Promise<void> {
		const refuse = (message: string) => outputPort.present({ success: false, message });
		const currentEmployee = await this.employeeMasterRepository.findCurrentEmployeeProfile();
		if (!currentEmployee?.enabled || !canEditSettings(currentEmployee.role)) {
			return refuse("設定を変更できるのは Admin のみです。");
		}

		const host = request.host.trim();
		const user = request.user.trim();
		const to = normalizeEmailAddress(request.to);
		const problem = smtpSettingsProblem(host, request.port, user);
		if (problem) {
			return refuse(problem);
		}
		if (!to) {
			return refuse("送信テストの宛先メールアドレスを1件入力してください。");
		}
		if (!isNotificationTemplateId(request.templateId)) {
			return refuse("送信テストの通知パターンを選んでください。");
		}

		await this.gateway.saveAfterTestMail(
			{ host, port: request.port, user, password: request.password },
			to,
			request.templateId,
		);
		outputPort.present({
			success: true,
			message: `テストメールを送信し、通知メールの設定を保存しました（送信元 ${user}、宛先 ${to}）。`,
		});
	}
}
