import firstEvaluated from "./notification-templates/first-evaluated.json" with { type: "json" };
import submitted from "./notification-templates/submitted.json" with { type: "json" };

const TEMPLATES = { submitted, first_evaluated: firstEvaluated };
export type NotificationTemplateId = keyof typeof TEMPLATES;

export interface NotificationTemplateData {
	employeeName: string;
	employeeNo: string;
	periodName: string;
	sheetId: string | number;
}

export const NOTIFICATION_TEMPLATES = Object.entries(TEMPLATES).map(([id, template]) => ({
	id: id as NotificationTemplateId,
	label: template.label,
}));

export function isNotificationTemplateId(value: unknown): value is NotificationTemplateId {
	return typeof value === "string" && Object.keys(TEMPLATES).includes(value);
}

/** 本文の差し込み値を再解釈しない。件名だけは改行を除く。 */
export function renderNotificationTemplate(
	id: NotificationTemplateId,
	data: NotificationTemplateData,
) {
	const template = TEMPLATES[id];
	const fill = (text: string) =>
		text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
			if (!Object.keys(data).includes(key)) {
				throw new Error(`Unknown notification template field: ${key}`);
			}
			return String(data[key as keyof NotificationTemplateData]);
		});
	return {
		subject: fill(template.subject).replace(/[\r\n]/g, " "),
		text: fill(template.body.join("\n")),
	};
}
