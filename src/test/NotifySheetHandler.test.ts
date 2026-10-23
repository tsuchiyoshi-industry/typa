import { expect, it, vi } from "vitest";
import { NOTIFICATION_TEMPLATES } from "../../supabase/functions/_shared/notificationTemplates";
import {
	createNotificationHandler,
	type NotificationBackend,
} from "../../supabase/functions/notify-sheet/handler";
import { composeTestMail } from "../../supabase/functions/notify-sheet/mail";

function setup() {
	const backend = {
		authenticate: vi.fn().mockResolvedValue("actor"),
		canSendTest: vi.fn().mockResolvedValue(true),
		claim: vi.fn().mockResolvedValue({
			claimId: "claim",
			notification: {
				sheetId: 1,
				status: "submitted",
				employeeName: "本人",
				employeeNo: "TEST001",
				periodName: "期間",
				recipients: [{ role: "primary", name: "評価者", email: "recipient@example.jp" }],
			},
		}),
		smtp: vi.fn().mockResolvedValue({
			smtp_host: "smtp.example.jp",
			smtp_port: 465,
			smtp_user: "sender@example.jp",
			smtp_password: "private-password",
		}),
		complete: vi.fn().mockResolvedValue(undefined),
		send: vi.fn().mockResolvedValue(undefined),
	} satisfies NotificationBackend;
	const handle = createNotificationHandler(backend);
	const request = (body: string = '{"sheetId":1}') =>
		handle(
			new Request("https://function.example", {
				method: "POST",
				body,
				headers: { Authorization: "Bearer token" },
			}),
		);
	return { backend, handle, request };
}
it.each(["null", "[]", "{}", '{"sheetId":0}', '{"sheetId":"1"}', "invalid", "x".repeat(4097)])(
	"rejects invalid request bodies",
	async (body) => {
		const { backend, request } = setup();
		expect((await request(body)).status).toBe(400);
		expect(backend.claim).not.toHaveBeenCalled();
	},
);
it("authenticates before claiming, and rejects unauthorized actors", async () => {
	const { backend, request } = setup();
	backend.authenticate.mockResolvedValueOnce(null);
	expect((await request()).status).toBe(401);
	expect(backend.claim).not.toHaveBeenCalled();
	backend.claim.mockRejectedValueOnce(new Error("denied"));
	expect((await request()).status).toBe(403);
	expect(backend.send).not.toHaveBeenCalled();
});
it("records successful delivery and never exposes settings", async () => {
	const { backend, request } = setup();
	const response = await request();
	expect(response.status).toBe(200);
	expect(await response.text()).not.toContain("private-password");
	expect(backend.complete).toHaveBeenCalledWith("claim", true);
});
it("records failure without disclosing SMTP diagnostics or passwords", async () => {
	const { backend, request } = setup();
	backend.send.mockRejectedValue(new Error("AUTH private-password internal-address"));
	const body = await (await request()).text();
	expect(body).toContain("送信に失敗");
	expect(body).not.toContain("private-password");
	expect(body).not.toContain("internal-address");
	expect(backend.complete).toHaveBeenCalledWith("claim", false);
});
it("does not send again after delivery or during cooldown", async () => {
	const { backend, request } = setup();
	backend.claim.mockResolvedValueOnce({ ...(await backend.claim()), skipped: "sent" });
	expect(await (await request()).json()).toMatchObject({ deliveries: [{ alreadySent: true }] });
	backend.claim.mockResolvedValueOnce({ skipped: "cooldown" });
	expect((await request()).status).toBe(429);
	expect(backend.send).not.toHaveBeenCalled();
});

const testRequest = (change: Record<string, unknown> = {}) =>
	JSON.stringify({
		mode: "test",
		to: " test@example.jp ",
		templateId: "submitted",
		...change,
	});

it.each(NOTIFICATION_TEMPLATES)(
	"sends the $id test without claiming or recording a sheet notification",
	async ({ id }) => {
		const { backend, request } = setup();
		const response = await request(testRequest({ templateId: id, sheetId: 999 }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(backend.canSendTest).toHaveBeenCalledWith("actor");
		expect(backend.send).toHaveBeenCalledExactlyOnceWith(
			await backend.smtp(),
			composeTestMail(id, "test@example.jp"),
		);
		expect(backend.claim).not.toHaveBeenCalled();
		expect(backend.complete).not.toHaveBeenCalled();
	},
);

it("requires login and an enabled Admin before reading SMTP settings or sending a test", async () => {
	const { backend, request } = setup();
	backend.authenticate.mockResolvedValueOnce(null);
	expect((await request(testRequest())).status).toBe(401);
	expect(backend.canSendTest).not.toHaveBeenCalled();
	backend.canSendTest.mockResolvedValueOnce(false);
	expect((await request(testRequest())).status).toBe(403);
	backend.canSendTest.mockRejectedValueOnce(new Error("unavailable"));
	expect((await request(testRequest())).status).toBe(503);
	expect(backend.smtp).not.toHaveBeenCalled();
	expect(backend.send).not.toHaveBeenCalled();
});

it.each([
	{ to: null },
	{ to: "" },
	{ to: "not-an-address" },
	{ to: "a@example.jp,b@example.jp" },
	{ to: "a@example.jp\r\nBcc: other@example.jp" },
	{ to: `${"a".repeat(255)}@example.jp` },
	{ templateId: null },
	{ templateId: "" },
	{ templateId: "finalized" },
	{ templateId: "__proto__" },
])("rejects invalid test input %j without sending", async (change) => {
	const { backend, request } = setup();
	expect((await request(testRequest(change))).status).toBe(400);
	expect(backend.smtp).not.toHaveBeenCalled();
	expect(backend.send).not.toHaveBeenCalled();
	expect(backend.claim).not.toHaveBeenCalled();
	expect(backend.complete).not.toHaveBeenCalled();
});

it("reports missing configuration and shows the SMTP error without the password", async () => {
	const { backend, request } = setup();
	backend.smtp.mockResolvedValueOnce(null);
	expect((await request(testRequest())).status).toBe(409);
	expect(backend.send).not.toHaveBeenCalled();
	backend.send.mockRejectedValueOnce(
		Object.assign(new Error("Invalid login: 535 bad credentials private-password"), {
			code: "EAUTH",
		}),
	);
	const response = await request(testRequest());
	expect(response.status).toBe(503);
	const { error } = await response.json();
	expect(error).toContain("テストメールを送信できませんでした");
	expect(error).toContain("EAUTH: Invalid login: 535 bad credentials ********");
	expect(error).not.toContain("private-password");
	expect(backend.complete).not.toHaveBeenCalled();
});

it.each([
	["a non-Error value", "socket closed", "socket closed"],
	["an error without a message", new Error(""), "Error"],
	["a very long message", new Error("x".repeat(1000)), "x".repeat(300)],
])("keeps the test failure readable for %s", async (_, thrown, expected) => {
	const { backend, request } = setup();
	backend.send.mockRejectedValueOnce(thrown);
	const { error } = await (await request(testRequest())).json();
	expect(error).toContain(`（詳細: ${expected}）`);
});

it("shows why the SMTP settings could not be read", async () => {
	const { backend, request } = setup();
	backend.smtp.mockRejectedValueOnce(new Error("connection refused"));
	const response = await request(testRequest());
	expect(response.status).toBe(503);
	expect((await response.json()).error).toContain("（詳細: connection refused）");
	expect(backend.send).not.toHaveBeenCalled();
});
