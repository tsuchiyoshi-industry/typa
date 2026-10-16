import { expect, it, vi } from "vitest";
import {
	createNotificationHandler,
	type NotificationBackend,
} from "../../supabase/functions/notify-sheet/handler";

function setup() {
	const backend = {
		authenticate: vi.fn().mockResolvedValue("actor"),
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
