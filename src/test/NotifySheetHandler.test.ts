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
		saveSmtp: vi.fn().mockResolvedValue(undefined),
		channel: vi.fn().mockResolvedValue("email"),
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

// 設定の保存: 入力された設定で送信テストを行い、成功したときだけ保存する
const entered = {
	smtp_host: "new.example.jp",
	smtp_port: 587,
	smtp_user: "new@example.jp",
	smtp_password: "new-password",
};
const saveRequest = (change: Record<string, unknown> = {}, smtp: Record<string, unknown> = {}) =>
	JSON.stringify({
		mode: "save",
		to: "test@example.jp",
		templateId: "submitted",
		smtp: {
			host: "new.example.jp",
			port: 587,
			user: "new@example.jp",
			password: "new-password",
			...smtp,
		},
		...change,
	});

it("sends a test mail with the entered settings, then saves them", async () => {
	const { backend, request } = setup();
	const response = await request(saveRequest());
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ success: true });
	expect(backend.send).toHaveBeenCalledExactlyOnceWith(
		entered,
		composeTestMail("submitted", "test@example.jp"),
	);
	expect(backend.saveSmtp).toHaveBeenCalledExactlyOnceWith(entered);
	expect(backend.send.mock.invocationCallOrder[0]).toBeLessThan(
		backend.saveSmtp.mock.invocationCallOrder[0],
	);
});

it("saves nothing when the test mail fails, and explains why without the password", async () => {
	const { backend, request } = setup();
	backend.send.mockRejectedValueOnce(
		Object.assign(new Error("received fatal alert: HandshakeFailure new-password"), {
			code: "ESOCKET",
		}),
	);
	const response = await request(saveRequest());
	expect(response.status).toBe(503);
	const { error } = await response.json();
	expect(error).toContain("テストメールを送信できませんでした");
	expect(error).toContain("ESOCKET: received fatal alert: HandshakeFailure ********");
	expect(error).not.toContain("new-password");
	expect(backend.saveSmtp).not.toHaveBeenCalled();
});

it("lets only an enabled Admin save, checking before anything is sent", async () => {
	const { backend, request } = setup();
	backend.canSendTest.mockResolvedValueOnce(false);
	expect((await request(saveRequest())).status).toBe(403);
	backend.canSendTest.mockRejectedValueOnce(new Error("unavailable"));
	expect((await request(saveRequest())).status).toBe(503);
	expect(backend.canSendTest).toHaveBeenCalledWith("actor");
	expect(backend.send).not.toHaveBeenCalled();
	expect(backend.saveSmtp).not.toHaveBeenCalled();
});

it.each([
	[{ to: null }, {}],
	[{ to: "not-an-address" }, {}],
	[{ to: "a@example.jp,b@example.jp" }, {}],
	[{ to: "a@example.jp\r\nBcc: other@example.jp" }, {}],
	[{ templateId: "finalized" }, {}],
	[{ templateId: "__proto__" }, {}],
	[{ smtp: null }, {}],
	[{ smtp: [] }, {}],
	[{ smtp: "smtp.example.jp" }, {}],
	[{}, { host: "" }],
	[{}, { host: " " }],
	[{}, { host: "smtp example.jp" }],
	[{}, { host: 1 }],
	[{}, { port: 0 }],
	[{}, { port: 70000 }],
	[{}, { port: 58.7 }],
	[{}, { port: "587" }],
	[{}, { port: null }],
	[{}, { user: "not-an-address" }],
	[{}, { user: "a@example.jp, b@example.jp" }],
	[{}, { user: null }],
	[{}, { password: 1234 }],
])("rejects %j %j without sending or saving", async (change, smtp) => {
	const { backend, request } = setup();
	expect((await request(saveRequest(change, smtp))).status).toBe(400);
	expect(backend.send).not.toHaveBeenCalled();
	expect(backend.saveSmtp).not.toHaveBeenCalled();
});

it("uses the stored password when it is left blank for the same server and sender", async () => {
	const { backend, request } = setup();
	const stored = await backend.smtp();
	const response = await request(
		saveRequest({}, { host: stored.smtp_host, user: stored.smtp_user, port: 587, password: "" }),
	);
	expect(response.status).toBe(200);
	const kept = { ...stored, smtp_port: 587 };
	expect(backend.send).toHaveBeenCalledExactlyOnceWith(kept, expect.anything());
	expect(backend.saveSmtp).toHaveBeenCalledExactlyOnceWith(kept);
});

it.each([
	["another server", { host: "attacker.example" }, undefined],
	["another sender", { user: "other@example.jp" }, undefined],
	["no stored password", {}, null],
	["an empty stored password", {}, ""],
])("requires the password again for %s", async (_, change, storedPassword) => {
	const { backend, request } = setup();
	const stored = await backend.smtp();
	if (storedPassword !== undefined) {
		backend.smtp.mockResolvedValue(
			storedPassword === null ? null : { ...stored, smtp_password: storedPassword },
		);
	}
	const response = await request(
		saveRequest({}, { host: stored.smtp_host, user: stored.smtp_user, password: "", ...change }),
	);
	expect(response.status).toBe(400);
	expect((await response.json()).error).toContain("パスワード");
	expect(backend.send).not.toHaveBeenCalled();
	expect(backend.saveSmtp).not.toHaveBeenCalled();
});

it("sends nothing when the stored settings cannot be read", async () => {
	const { backend, request } = setup();
	backend.smtp.mockRejectedValueOnce(new Error("connection refused"));
	const stored = { host: "smtp.example.jp", user: "sender@example.jp", password: "" };
	const response = await request(saveRequest({}, stored));
	expect(response.status).toBe(503);
	expect((await response.json()).error).toContain("読み込めませんでした");
	expect(backend.send).not.toHaveBeenCalled();
	expect(backend.saveSmtp).not.toHaveBeenCalled();
});

it("says the test mail went out when only saving fails", async () => {
	const { backend, request } = setup();
	backend.saveSmtp.mockRejectedValueOnce(new Error("database unavailable"));
	const response = await request(saveRequest());
	expect(response.status).toBe(503);
	const { error } = await response.json();
	expect(error).toContain("テストメールは送信しましたが、設定を保存できませんでした");
	expect(error).not.toContain("new-password");
});

it.each(NOTIFICATION_TEMPLATES)(
	"saves after the $id sample without claiming or recording a sheet notification",
	async ({ id }) => {
		const { backend, request } = setup();
		const response = await request(saveRequest({ templateId: id, sheetId: 999 }));
		expect(response.status).toBe(200);
		expect(backend.send).toHaveBeenCalledExactlyOnceWith(
			entered,
			composeTestMail(id, "test@example.jp"),
		);
		expect(backend.claim).not.toHaveBeenCalled();
		expect(backend.complete).not.toHaveBeenCalled();
	},
);

it("requires login before checking the Admin", async () => {
	const { backend, request } = setup();
	backend.authenticate.mockResolvedValueOnce(null);
	expect((await request(saveRequest())).status).toBe(401);
	expect(backend.canSendTest).not.toHaveBeenCalled();
	expect(backend.send).not.toHaveBeenCalled();
});

it.each([
	{ to: "" },
	{ to: `${"a".repeat(255)}@example.jp` },
	{ templateId: null },
	{ templateId: "" },
])("rejects the test recipient or pattern %j without sending", async (change) => {
	const { backend, request } = setup();
	expect((await request(saveRequest(change))).status).toBe(400);
	expect(backend.send).not.toHaveBeenCalled();
	expect(backend.saveSmtp).not.toHaveBeenCalled();
});

it.each([
	["a non-Error value", "socket closed", "socket closed"],
	["an error without a message", new Error(""), "Error"],
	["a very long message", new Error("x".repeat(1000)), "x".repeat(300)],
])("keeps the test failure readable for %s", async (_, thrown, expected) => {
	const { backend, request } = setup();
	backend.send.mockRejectedValueOnce(thrown);
	const { error } = await (await request(saveRequest())).json();
	expect(error).toContain(`（詳細: ${expected}）`);
});

it("no longer accepts a test with the saved settings that skips saving", async () => {
	const { backend, request } = setup();
	const response = await request(
		JSON.stringify({ mode: "test", to: "test@example.jp", templateId: "submitted" }),
	);
	expect(response.status).toBe(400);
	expect(backend.smtp).not.toHaveBeenCalled();
	expect(backend.send).not.toHaveBeenCalled();
});

it("sends no mail and records nothing while the workspace notifies in the app", async () => {
	const { backend, request } = setup();
	backend.channel.mockResolvedValueOnce("in_app");
	const response = await request();
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ deliveries: [] });
	expect(backend.claim).not.toHaveBeenCalled();
	expect(backend.send).not.toHaveBeenCalled();
});

it("sends nothing when it cannot tell how the workspace notifies", async () => {
	const { backend, request } = setup();
	backend.channel.mockRejectedValueOnce(new Error("database unavailable"));
	const response = await request();
	expect(response.status).toBe(503);
	expect((await response.json()).error).toContain("通知の設定を読み込めませんでした");
	expect(backend.claim).not.toHaveBeenCalled();
	expect(backend.send).not.toHaveBeenCalled();
});
