import { normalizeEmailAddress } from "../../../supabase/functions/_shared/emailAddress";
import { isNotificationTemplateId } from "../../../supabase/functions/_shared/notificationTemplates";
import type { EmployeeMasterRepository } from "../../domain/repositories/EmployeeMasterRepository";
import { canEditSettings } from "../../domain/services/EmployeeMasterAccessService";
import type { NotificationTestGateway } from "../ports/NotificationTestGateway";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";

export interface SendTestNotificationRequest {
	to: string;
	templateId: string;
}
export interface SendTestNotificationResponse {
	success: boolean;
	message: string;
}

export class SendTestNotificationInteractor
	implements UseCase<SendTestNotificationRequest, OutputPort<SendTestNotificationResponse>>
{
	constructor(
		private readonly gateway: NotificationTestGateway,
		private readonly employees: Pick<EmployeeMasterRepository, "findCurrentEmployeeProfile">,
	) {}
	async execute(
		request: SendTestNotificationRequest,
		output: OutputPort<SendTestNotificationResponse>,
	): Promise<void> {
		const actor = await this.employees.findCurrentEmployeeProfile();
		if (!actor?.enabled || !canEditSettings(actor.role)) {
			output.present({ success: false, message: "送信テストは Admin のみ利用できます。" });
			return;
		}
		const to = normalizeEmailAddress(request.to);
		if (!to) {
			output.present({ success: false, message: "宛先メールアドレスを1件入力してください。" });
			return;
		}
		if (!isNotificationTemplateId(request.templateId)) {
			output.present({ success: false, message: "送信する通知パターンを選んでください。" });
			return;
		}
		await this.gateway.sendTest(to, request.templateId);
		output.present({ success: true, message: `テストメールを送信しました（宛先 ${to}）。` });
	}
}
