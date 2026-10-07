import { invoke } from "@tauri-apps/api/core";
import type {
	EmailNotificationRepository,
	SheetNotification,
} from "../../domain/repositories/EmailNotificationRepository";
import type { EvaluationNotificationRecipientRepository } from "../../domain/repositories/EvaluationNotificationRecipientRepository";

const validAddress = (email: string | null | undefined): string | null => {
	const trimmed = email?.trim();
	return trimmed && /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(trimmed) ? trimmed : null;
};

const send = (to: string, subject: string, lines: string[]) =>
	invoke("send_email", {
		request: {
			smtpHost: import.meta.env.VITE_SMTP_HOST,
			smtpPort: Number(import.meta.env.VITE_SMTP_PORT),
			smtpUser: import.meta.env.VITE_SMTP_USER,
			smtpPassword: import.meta.env.VITE_SMTP_PASSWORD,
			to,
			subject,
			body: lines.join("\n"),
		},
	});

export class TauriEmailNotificationRepository implements EmailNotificationRepository {
	constructor(private readonly recipients: EvaluationNotificationRecipientRepository) {}

	async notifyFirstEvaluationConfirmed(notification: SheetNotification): Promise<void> {
		const to = validAddress(
			await this.recipients.findFirstEvaluatedSheetRecipient(notification.sheetId),
		);
		if (!to) {
			throw new Error("二次評価者の認証済み登録メールがありません。");
		}
		await send(
			to,
			`【TYPA】二次評価のお願い（${notification.employeeName} / ${notification.periodName}）`,
			[
				`${notification.employeeName}（${notification.employeeNo}）の一次評価が確定しました。`,
				"二次評価を入力し、評価を確定してください。",
				"",
				`評価期間: ${notification.periodName}`,
				`シートID: ${notification.sheetId}`,
			],
		);
	}

	async notifySheetFinalized(notification: SheetNotification): Promise<void> {
		const recipients = await this.recipients.findFinalizedSheetRecipients(notification.sheetId);
		const addresses = new Map<string, string>();
		const missingRoles: string[] = [];
		for (const recipient of recipients) {
			// 二次評価者がいない社員は、宛先がなくて正しい
			if (recipient.role === "secondary" && recipient.employeeId === null) {
				continue;
			}
			const email = validAddress(recipient.email);
			if (!email) {
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
				send(
					to,
					`【TYPA】評価シート確定通知（${notification.employeeName} / ${notification.periodName}）`,
					[
						`${notification.employeeName}（${notification.employeeNo}）の評価シートが確定しました。`,
						"",
						`評価期間: ${notification.periodName}`,
						`シートID: ${notification.sheetId}`,
					],
				),
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
