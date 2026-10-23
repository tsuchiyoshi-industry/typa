import type { NotificationTestGateway } from "../../application/ports/NotificationTestGateway";
import type {
	EmailNotificationRepository,
	NotificationDelivery,
	ReportDelivery,
	SheetNotification,
} from "../../domain/repositories/EmailNotificationRepository";
import { supabase } from "../db/supabase";

/**
 * 通知メールは Edge Function(notify-sheet)が送る。通常通知の宛先・文面はシートの状態から決め、
 * 評価者のメールアドレスと SMTP のパスワードはアプリに渡さない。送信テストは入力した宛先を使う。
 */
export class SupabaseEmailNotificationRepository
	implements EmailNotificationRepository, NotificationTestGateway
{
	private async invoke<T>(body: Record<string, unknown>): Promise<T | null> {
		const { data, error } = await supabase.functions.invoke<T>("notify-sheet", { body });

		if (error) {
			// 関数が返した理由(JSON の error)があれば、それを伝える
			const reason = await (error as { context?: Response }).context
				?.json()
				.then((body: { error?: unknown }) => body.error)
				.catch(() => undefined);
			throw new Error(typeof reason === "string" ? reason : "通知メールを送信できませんでした。");
		}
		return data;
	}

	async sendTest(to: string, templateId: string): Promise<void> {
		const data = await this.invoke<{ success?: boolean }>({ mode: "test", to, templateId });
		if (data?.success !== true) {
			throw new Error("テストメールを送信できませんでした。");
		}
	}

	private async notify(notification: SheetNotification, report: ReportDelivery): Promise<void> {
		const data = await this.invoke<{ deliveries?: NotificationDelivery[] }>({
			sheetId: notification.sheetId,
		});
		for (const delivery of data?.deliveries ?? []) {
			report(delivery);
		}
	}

	notifySheetSubmitted(notification: SheetNotification, report: ReportDelivery): Promise<void> {
		return this.notify(notification, report);
	}

	notifyFirstEvaluationConfirmed(
		notification: SheetNotification,
		report: ReportDelivery,
	): Promise<void> {
		return this.notify(notification, report);
	}
}
