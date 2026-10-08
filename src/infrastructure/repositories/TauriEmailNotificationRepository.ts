import { invoke } from "@tauri-apps/api/core";
import type {
	EmailNotificationRepository,
	ReportDelivery,
	SheetNotification,
} from "../../domain/repositories/EmailNotificationRepository";
import type { EvaluationNotificationRecipientRepository } from "../../domain/repositories/EvaluationNotificationRecipientRepository";
import type { WorkspaceSettingsRepository } from "../../domain/repositories/WorkspaceSettingsRepository";

const validAddress = (email: string | null | undefined): string | null => {
	const trimmed = email?.trim();
	return trimmed && /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(trimmed) ? trimmed : null;
};

const NO_ADDRESS = "認証済みの登録メールがありません。";

export class TauriEmailNotificationRepository implements EmailNotificationRepository {
	constructor(
		private readonly recipients: EvaluationNotificationRecipientRepository,
		private readonly settings: Pick<WorkspaceSettingsRepository, "findNotificationSmtp">,
	) {}

	/** SMTP 設定を読み、宛先ひとりに送って結果を知らせる関数を返す。 */
	private async sender(report: ReportDelivery) {
		const smtp = await this.settings.findNotificationSmtp();
		if (!smtp.host || !smtp.user) {
			throw new Error("SMTP設定が登録されていません。Admin が設定画面で登録してください。");
		}
		return async (recipient: string, to: string, subject: string, lines: string[]) => {
			try {
				await invoke("send_email", {
					request: {
						smtpHost: smtp.host,
						smtpPort: smtp.port,
						smtpUser: smtp.user,
						smtpPassword: smtp.password,
						to,
						subject,
						body: lines.join("\n"),
					},
				});
				report({ recipient });
			} catch (error) {
				// Tauri コマンドの失敗は、Rust 側のメッセージ(文字列)で届く
				report({
					recipient,
					error:
						typeof error === "string"
							? error
							: error instanceof Error
								? error.message
								: "メール送信に失敗しました。",
				});
			}
		};
	}

	async notifyFirstEvaluationConfirmed(
		notification: SheetNotification,
		report: ReportDelivery,
	): Promise<void> {
		const [email, send] = await Promise.all([
			this.recipients.findFirstEvaluatedSheetRecipient(notification.sheetId),
			this.sender(report),
		]);
		const recipient = `${notification.secondaryEvaluatorName}（二次評価者）`;
		const to = validAddress(email);
		if (!to) {
			report({ recipient, error: NO_ADDRESS });
			return;
		}
		await send(
			recipient,
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

	async notifySheetFinalized(
		notification: SheetNotification,
		report: ReportDelivery,
	): Promise<void> {
		const [recipients, send] = await Promise.all([
			this.recipients.findFinalizedSheetRecipients(notification.sheetId),
			this.sender(report),
		]);
		const labels = {
			primary: `${notification.primaryEvaluatorName}（一次評価者）`,
			secondary: `${notification.secondaryEvaluatorName}（二次評価者）`,
		};
		// 同じ宛先は1通にまとめる
		const targets = new Map<string, { to: string; labels: string[] }>();
		for (const recipient of recipients) {
			// 二次評価者がいない社員は、宛先がなくて正しい
			if (recipient.role === "secondary" && recipient.employeeId === null) {
				continue;
			}
			const to = validAddress(recipient.email);
			if (!to) {
				report({ recipient: labels[recipient.role], error: NO_ADDRESS });
				continue;
			}
			const target = targets.get(to.toLowerCase()) ?? { to, labels: [] };
			target.labels.push(labels[recipient.role]);
			targets.set(to.toLowerCase(), target);
		}
		// Send separately so one evaluator's address is not disclosed to the other.
		await Promise.all(
			[...targets.values()].map((target) =>
				send(
					target.labels.join("・"),
					target.to,
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
	}
}
