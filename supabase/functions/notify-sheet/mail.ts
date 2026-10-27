// Who gets which mail for a sheet's current status. No runtime dependencies, so the app's
// test suite covers it (src/test/NotifySheetMail.test.ts).
import { normalizeEmailAddress } from "../_shared/emailAddress.ts";
import {
	type NotificationTemplateId,
	renderNotificationTemplate,
} from "../_shared/notificationTemplates.ts";

/** What the database function get_sheet_notification returns. */
export interface SheetNotification {
	status: NotificationTemplateId;
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
	/** 目標の差し戻しの理由。差し戻し以外では空(古い DB では無い)。 */
	returnReason?: string;
	/** email: the mailbox verified at sign-up; null when the evaluator is unassigned or not registered. */
	recipients: { role: "subject" | "primary" | "secondary"; name: string; email: string | null }[];
}

/** The result for one recipient, as the app shows it. recipient: e.g. 山田 太郎（二次評価者） */
export interface Delivery {
	recipient: string;
	error?: string;
}

export interface Mail {
	recipient: string;
	to: string;
	subject: string;
	text: string;
}

const ROLE_LABELS = { subject: "本人", primary: "一次評価者", secondary: "二次評価者" };
const NO_ADDRESS = "認証済みの登録メールがありません。";

/** 実データを参照せず、通常通知と同じテンプレートでテスト用メールを作る。 */
export function composeTestMail(templateId: NotificationTemplateId, to: string): Mail {
	const content = renderNotificationTemplate(templateId, {
		employeeName: "テスト社員",
		employeeNo: "TEST001",
		periodName: "送信テスト",
		sheetId: "サンプル",
		returnReason: "（ここに一次評価者が書いた差し戻しの理由が入ります）",
	});
	return {
		recipient: "送信テスト",
		to,
		subject: `【送信テスト】${content.subject}`,
		text: `これは通知メールの送信テストです。実際の評価シートではありません。\n\n${content.text}`,
	};
}

/**
 * One mail per address: an evaluator who holds both roles gets a single mail, and each mail
 * goes to one address so evaluators do not learn each other's. Recipients without a usable
 * address are reported instead.
 */
export function composeMails(notification: SheetNotification): {
	mails: Mail[];
	undeliverable: Delivery[];
} {
	const { subject, text } = renderNotificationTemplate(notification.status, {
		...notification,
		returnReason: notification.returnReason ?? "",
	});

	const targets = new Map<string, { to: string; labels: string[] }>();
	const undeliverable: Delivery[] = [];
	for (const recipient of notification.recipients) {
		const label = `${recipient.name}（${ROLE_LABELS[recipient.role]}）`;
		const to = normalizeEmailAddress(recipient.email);
		if (!to) {
			undeliverable.push({ recipient: label, error: NO_ADDRESS });
			continue;
		}
		const target = targets.get(to.toLowerCase()) ?? { to, labels: [] };
		target.labels.push(label);
		targets.set(to.toLowerCase(), target);
	}

	return {
		mails: [...targets.values()].map((target) => ({
			recipient: target.labels.join("・"),
			to: target.to,
			subject,
			text,
		})),
		undeliverable,
	};
}
