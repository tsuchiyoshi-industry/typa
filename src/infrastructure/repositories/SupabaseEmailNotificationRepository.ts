import type {
	EmailNotificationRepository,
	NotificationDelivery,
	ReportDelivery,
	SheetNotification,
} from "../../domain/repositories/EmailNotificationRepository";
import { supabase } from "../db/supabase";

/**
 * 通知メールは Edge Function(notify-sheet)が送る。誰に何を送るかは、関数がシートのいまの状態から
 * 決める。宛先のメールアドレスも SMTP のパスワードも、アプリには渡らない。
 */
export class SupabaseEmailNotificationRepository implements EmailNotificationRepository {
	private async notify(notification: SheetNotification, report: ReportDelivery): Promise<void> {
		const { data, error } = await supabase.functions.invoke<{
			deliveries?: NotificationDelivery[];
		}>("notify-sheet", { body: { sheetId: notification.sheetId } });

		if (error) {
			// 関数が返した理由(JSON の error)があれば、それを伝える
			const reason = await (error as { context?: Response }).context
				?.json()
				.then((body: { error?: unknown }) => body.error)
				.catch(() => undefined);
			throw new Error(typeof reason === "string" ? reason : "通知メールを送信できませんでした。");
		}
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

	notifySheetFinalized(notification: SheetNotification, report: ReportDelivery): Promise<void> {
		return this.notify(notification, report);
	}
}
