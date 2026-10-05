import { invoke } from "@tauri-apps/api/core";
import type {
	EmailNotificationRepository,
	SheetFinalizedNotification,
} from "../../domain/repositories/EmailNotificationRepository";
import type { EvaluationNotificationRecipientRepository } from "../../domain/repositories/EvaluationNotificationRecipientRepository";

export class TauriEmailNotificationRepository implements EmailNotificationRepository {
	constructor(private readonly recipients: EvaluationNotificationRecipientRepository) {}

	async notifySheetFinalized(notification: SheetFinalizedNotification): Promise<void> {
		const recipients = await this.recipients.findFinalizedSheetRecipients(notification.sheetId);
		const addresses = new Map<string, string>();
		const missingRoles: string[] = [];
		for (const recipient of recipients) {
			const email = recipient.email?.trim();
			if (!email || !/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(email)) {
				missingRoles.push(recipient.role === "primary" ? "一次評価者" : "二次評価者");
				continue;
			}
			addresses.set(email.toLowerCase(), email);
		}
		if (!addresses.size) {
			throw new Error("評価者の認証済み登録メールがありません。");
		}
		// Send separately so one evaluator's address is not disclosed to the other.
		const results = await Promise.allSettled(
			[...addresses.values()].map((to) =>
				invoke("send_email", {
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
				}),
			),
		);
		const failures = results.filter((result) => result.status === "rejected").length;
		if (failures || missingRoles.length) {
			throw new Error(
				`評価確定通知: 送信失敗${failures}件、登録メール未設定: ${missingRoles.join("・") || "なし"}`,
			);
		}
	}
}
