import { expect, it } from "vitest";
import {
	NOTIFICATION_TEMPLATES,
	renderNotificationTemplate,
} from "../../supabase/functions/_shared/notificationTemplates";
import {
	composeMails,
	composeTestMail,
	type SheetNotification,
} from "../../supabase/functions/notify-sheet/mail";

const notification = (
	status: SheetNotification["status"],
	recipients: SheetNotification["recipients"],
): SheetNotification => ({
	status,
	sheetId: 100,
	employeeName: "テスト社員",
	employeeNo: "TEST001",
	periodName: "テスト期間",
	recipients,
});
const primary = { role: "primary", name: "一次", email: "first@example.jp" } as const;
const secondary = { role: "secondary", name: "二次", email: "second@example.jp" } as const;

it.each([
	["submitted", primary, "一次評価のお願い", "テスト社員（TEST001）が評価シートを提出しました。"],
	[
		"first_evaluated",
		secondary,
		"二次評価のお願い",
		"テスト社員（TEST001）の一次評価が確定しました。",
	],
] as const)(
	"tells the recipient what happened when a sheet is %s",
	(status, recipient, title, line) => {
		const { mails, undeliverable } = composeMails(notification(status, [recipient]));
		expect(undeliverable).toEqual([]);
		expect(mails).toHaveLength(1);
		expect(mails[0]).toMatchObject({
			to: recipient.email,
			subject: `【TYPA】${title}（テスト社員 / テスト期間）`,
		});
		expect(mails[0].text.split("\n")[0]).toBe(line);
		expect(mails[0].text).toContain("評価期間: テスト期間\nシートID: 100");
	},
);

it.each(NOTIFICATION_TEMPLATES)(
	"uses the same template for the $id test notification",
	({ id }) => {
		const data = {
			employeeName: "テスト社員",
			employeeNo: "TEST001",
			periodName: "送信テスト",
			sheetId: "サンプル",
		};
		const content = renderNotificationTemplate(id, data);
		const mail = composeTestMail(id, "test@example.jp");
		expect(mail.to).toBe("test@example.jp");
		expect(mail.subject).toBe(`【送信テスト】${content.subject}`);
		expect(mail.text).toBe(
			`これは通知メールの送信テストです。実際の評価シートではありません。\n\n${content.text}`,
		);
		expect(mail.text).not.toMatch(/\{\{\w+\}\}/);
	},
);

it("does not reinterpret replacement values or allow subject line breaks", () => {
	const content = renderNotificationTemplate("submitted", {
		employeeName: "{{periodName}}\r\n社員",
		employeeNo: "TEST001",
		periodName: "テスト期間",
		sheetId: 1,
	});
	expect(content.subject).not.toMatch(/[\r\n]/);
	expect(content.subject).toContain("{{periodName}}");
	expect(content.text).toContain("{{periodName}}\r\n社員");
});

it("sends each evaluator their own mail, so neither learns the other's address", () => {
	const { mails } = composeMails(notification("first_evaluated", [primary, secondary]));
	expect(mails.map((mail) => [mail.recipient, mail.to])).toEqual([
		["一次（一次評価者）", "first@example.jp"],
		["二次（二次評価者）", "second@example.jp"],
	]);
});

it("sends one mail to an evaluator who holds both roles", () => {
	const { mails } = composeMails(
		notification("first_evaluated", [primary, { ...secondary, email: "First@Example.jp " }]),
	);
	expect(mails).toHaveLength(1);
	expect(mails[0]).toMatchObject({
		recipient: "一次（一次評価者）・二次（二次評価者）",
		to: "first@example.jp",
	});
});

it.each([null, "", "not an address", "a@b.jp, c@d.jp", "<a@b.jp>"])(
	"reports a recipient without a usable address (%s) instead of sending",
	(email) => {
		const { mails, undeliverable } = composeMails(
			notification("first_evaluated", [primary, { ...secondary, email }]),
		);
		expect(mails.map((mail) => mail.to)).toEqual(["first@example.jp"]);
		expect(undeliverable).toEqual([
			{ recipient: "二次（二次評価者）", error: "認証済みの登録メールがありません。" },
		]);
	},
);

it.each(["draft", "goals_confirmed"] as const)("sends %s instructions to the subject", (status) => {
	const { mails } = composeMails(
		notification(status, [{ role: "subject", name: "本人", email: "subject@example.jp" }]),
	);
	expect(mails[0]).toMatchObject({ recipient: "本人（本人）", to: "subject@example.jp" });
	expect(mails[0].text).toContain(
		status === "draft" ? "目標を修正して再送信" : "本人から一次評価を依頼",
	);
});
