// Who gets which mail for a sheet's current status. No runtime dependencies, so the app's
// test suite covers it (src/test/NotifySheetMail.test.ts).

/** What the database function get_sheet_notification returns. */
export interface SheetNotification {
	status: "submitted" | "first_evaluated";
	sheetId: number;
	employeeName: string;
	employeeNo: string;
	periodName: string;
	/** email: the mailbox verified at sign-up; null when the evaluator is unassigned or not registered. */
	recipients: { role: "primary" | "secondary"; name: string; email: string | null }[];
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

const ROLE_LABELS = { primary: "一次評価者", secondary: "二次評価者" };
const NO_ADDRESS = "認証済みの登録メールがありません。";

const validAddress = (email: string | null): string | null => {
	const trimmed = email?.trim();
	return trimmed && /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(trimmed) ? trimmed : null;
};

function content(notification: SheetNotification): { title: string; lines: string[] } {
	const who = `${notification.employeeName}（${notification.employeeNo}）`;
	switch (notification.status) {
		case "submitted":
			return {
				title: "一次評価のお願い",
				lines: [`${who}が評価シートを提出しました。`, "一次評価を入力し、確定してください。"],
			};
		default:
			return {
				title: "二次評価のお願い",
				lines: [`${who}の一次評価が確定しました。`, "二次評価を入力し、評価を確定してください。"],
			};
	}
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
	const { title, lines } = content(notification);
	const subject = `【TYPA】${title}（${notification.employeeName} / ${notification.periodName}）`;
	const text = [
		...lines,
		"",
		`評価期間: ${notification.periodName}`,
		`シートID: ${notification.sheetId}`,
	].join("\n");

	const targets = new Map<string, { to: string; labels: string[] }>();
	const undeliverable: Delivery[] = [];
	for (const recipient of notification.recipients) {
		const label = `${recipient.name}（${ROLE_LABELS[recipient.role]}）`;
		const to = validAddress(recipient.email);
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
