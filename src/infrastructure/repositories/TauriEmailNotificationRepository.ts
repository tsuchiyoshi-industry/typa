import { invoke } from "@tauri-apps/api/core";
import type {
	EmailNotificationRepository,
	SheetFinalizedNotification,
} from "../../domain/repositories/EmailNotificationRepository";

export class TauriEmailNotificationRepository implements EmailNotificationRepository {
	async notifySheetFinalized(notification: SheetFinalizedNotification): Promise<void> {
		const to = import.meta.env.VITE_SHEET_FINALIZED_NOTIFY_TO;
		if (!to) {
			return;
		}

		await invoke("send_email", {
			request: {
				smtpHost: import.meta.env.VITE_SMTP_HOST,
				smtpPort: Number(import.meta.env.VITE_SMTP_PORT),
				smtpUser: import.meta.env.VITE_SMTP_USER,
				smtpPassword: import.meta.env.VITE_SMTP_PASSWORD,
				to,
				subject: `【TYPA】評価シート確定通知（${notification.employeeName} / ${notification.periodName}）`,
				body: [
					`${notification.employeeName}（${notification.employeeNo}）の評価シートが確定しました。`,
					"",
					`評価期間: ${notification.periodName}`,
					`シートID: ${notification.sheetId}`,
				].join("\n"),
			},
		});
	}
}
