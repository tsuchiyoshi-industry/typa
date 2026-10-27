import { describe, expect, it, vi } from "vitest";
import {
	createNotificationHandler,
	type NotificationBackend,
} from "../../../supabase/functions/notify-sheet/handler";

// ASVS v5.0.0: V8.3.3, V2.2.1–2, V2.4.1, V16.5.1–3.
// 実際のHTTPハンドラーにRequestを渡す。Auth/DB/SMTP自体の検証は別途必要。
function setup() {
	const backend = {
		authenticate: vi.fn().mockResolvedValue("verified-actor"),
		canSendTest: vi.fn().mockResolvedValue(false),
		channel: vi.fn().mockResolvedValue("email"),
		claim: vi.fn().mockResolvedValue({
			claimId: "server-claim",
			notification: {
				sheetId: 1,
				status: "submitted",
				employeeName: "本人",
				employeeNo: "E4",
				periodName: "今期",
				recipients: [{ role: "primary", name: "評価者", email: "reviewer@example.jp" }],
			},
		}),
		smtp: vi.fn().mockResolvedValue({
			smtp_host: "smtp.example.jp",
			smtp_port: 465,
			smtp_user: "sender@example.jp",
			smtp_password: "synthetic-secret",
		}),
		send: vi.fn().mockResolvedValue(undefined),
		complete: vi.fn().mockResolvedValue(undefined),
		saveSmtp: vi.fn().mockResolvedValue(undefined),
	} satisfies NotificationBackend;
	const handle = createNotificationHandler(backend);
	const request = (body = '{"sheetId":1}', headers: HeadersInit = {}) =>
		handle(
			new Request("https://function.example/notify-sheet", {
				method: "POST",
				headers: { Authorization: "Bearer valid-token", ...headers },
				body,
			}),
		);
	const noEffects = () => {
		for (const effect of [
			backend.claim,
			backend.smtp,
			backend.send,
			backend.complete,
			backend.saveSmtp,
		]) {
			expect(effect).not.toHaveBeenCalled();
		}
	};
	return { backend, handle, request, noEffects };
}

describe("authentication / CSRF / CORS", () => {
	it.each([
		"",
		"valid-token",
		"Basic valid-token",
		"Bearer",
		"Bearer    ",
		"Bearer valid-token extra",
	])(
		"rejects malformed Authorization %j before invoking privileged services",
		async (authorization) => {
			const { request, backend, noEffects } = setup();
			expect((await request(undefined, { Authorization: authorization })).status).toBe(401);
			expect(backend.authenticate).not.toHaveBeenCalled();
			noEffects();
		},
	);
	it("accepts a case-insensitive Bearer scheme and authenticates the extracted token", async () => {
		const { backend, request } = setup();
		expect((await request(undefined, { Authorization: "bEaReR valid-token" })).status).toBe(200);
		expect(backend.authenticate).toHaveBeenCalledExactlyOnceWith("valid-token");
	});
	it.each(["invalid", "expired", "forged"])(
		"fails closed when Auth rejects a %s token",
		async (token) => {
			const { backend, request, noEffects } = setup();
			backend.authenticate.mockResolvedValue(null);
			expect((await request(undefined, { Authorization: `Bearer ${token}` })).status).toBe(401);
			expect(backend.authenticate).toHaveBeenCalledExactlyOnceWith(token);
			noEffects();
		},
	);
	it("fails closed without disclosing authentication exceptions", async () => {
		const { backend, request, noEffects } = setup();
		backend.authenticate.mockRejectedValue(new Error("synthetic-secret SELECT auth.users"));
		const response = await request();
		expect(response.status).toBe(401);
		expect(await response.text()).not.toMatch(/synthetic-secret|auth\.users/);
		noEffects();
	});
	it("does not authenticate a cross-origin POST with only cookies", async () => {
		const { handle, backend, noEffects } = setup();
		const response = await handle(
			new Request("https://function.example", {
				method: "POST",
				body: '{"sheetId":1}',
				headers: { Origin: "https://attacker.example", Cookie: "session=valid-token" },
			}),
		);
		expect(response.status).toBe(401);
		expect(backend.authenticate).not.toHaveBeenCalled();
		noEffects();
	});
	it("preflights without side effects or credentialed wildcard CORS", async () => {
		const { handle, backend, noEffects } = setup();
		const response = await handle(
			new Request("https://function.example", {
				method: "OPTIONS",
				headers: { Origin: "https://attacker.example" },
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
		expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
		expect(backend.authenticate).not.toHaveBeenCalled();
		noEffects();
	});
});

it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD"])(
	"rejects unsupported HTTP method %s",
	async (method) => {
		const { handle, backend, noEffects } = setup();
		expect((await handle(new Request("https://function.example", { method }))).status).toBe(405);
		expect(backend.authenticate).not.toHaveBeenCalled();
		noEffects();
	},
);

it.each([
	"null",
	"[]",
	"true",
	"1",
	'"text"',
	"{",
	'{"sheetId":-1}',
	'{"sheetId":0}',
	'{"sheetId":1.5}',
	'{"sheetId":9007199254740992}',
	'{"sheetId":"1"}',
	'{"sheetId":{"$gt":0}}',
	'{"sheetId":1,"mode":"test"}',
])("rejects untrusted JSON shape or numeric input %s without side effects", async (body) => {
	const { request, noEffects } = setup();
	expect((await request(body)).status).toBe(400);
	noEffects();
});

it("ignores forged actor, recipients, SMTP settings and prototype properties", async () => {
	const { backend, request } = setup();
	const response = await request(`{"sheetId":1,"actor":"admin","isAdmin":true,
		"to":"attacker@example.jp","recipients":["attacker@example.jp"],
		"smtp":{"host":"attacker.example"},"__proto__":{"isAdmin":true},
		"constructor":{"prototype":{"isAdmin":true}}}`);
	expect(response.status).toBe(200);
	expect(backend.claim).toHaveBeenCalledExactlyOnceWith(1, "verified-actor");
	expect(backend.send).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ smtp_host: "smtp.example.jp" }),
		expect.objectContaining({ to: "reviewer@example.jp" }),
	);
	expect(Object.prototype).not.toHaveProperty("isAdmin");
	expect(await response.text()).not.toMatch(/attacker|synthetic-secret|reviewer@example/);
});

it.each([false, "unavailable"])(
	"does not save or test SMTP when Admin authorization is %s",
	async (permission) => {
		const { backend, request, noEffects } = setup();
		if (permission === "unavailable") {
			backend.canSendTest.mockRejectedValue(new Error("synthetic-secret internal-db"));
		}
		const response = await request('{"mode":"save","isAdmin":true,"actor":"admin"}');
		expect(response.status).toBe(permission === false ? 403 : 503);
		expect(backend.canSendTest).toHaveBeenCalledExactlyOnceWith("verified-actor");
		expect(await response.text()).not.toMatch(/synthetic-secret|internal-db/);
		noEffects();
	},
);

describe("body resource limits", () => {
	const bodyOf = (size: number) => `{"sheetId":1,"padding":"${"x".repeat(size - 26)}"}`;
	it("accepts exactly 4096 bytes (positive boundary control)", async () => {
		const { request } = setup();
		const body = bodyOf(4096);
		expect(new TextEncoder().encode(body)).toHaveLength(4096);
		expect((await request(body)).status).toBe(200);
	});
	it("rejects 4097 bytes despite a forged Content-Length", async () => {
		const { request, noEffects } = setup();
		expect((await request(bodyOf(4097), { "Content-Length": "1" })).status).toBe(400);
		noEffects();
	});
	it("counts UTF-8 bytes rather than UTF-16 string length", async () => {
		const { request, noEffects } = setup();
		const body = JSON.stringify({ sheetId: 1, padding: "あ".repeat(1400) });
		expect(body.length).toBeLessThan(4096);
		expect((await request(body)).status).toBe(400);
		noEffects();
	});
	it("cancels a chunked body at the limit without reading its remainder", async () => {
		const { handle, noEffects } = setup();
		const cancel = vi.fn();
		let pulls = 0;
		const stream = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulls++;
					controller.enqueue(new Uint8Array(2049));
				},
				cancel,
			},
			{ highWaterMark: 0 },
		);
		const response = await handle(
			new Request("https://function.example", {
				method: "POST",
				headers: { Authorization: "Bearer valid-token" },
				body: stream,
				duplex: "half",
			} as RequestInit),
		);
		expect(response.status).toBe(400);
		expect(pulls).toBe(2);
		expect(cancel).toHaveBeenCalledOnce();
		noEffects();
	});
});

it.each(["cooldown", "limit", "rate_limit"])(
	"honors the server's %s rejection without SMTP work",
	async (skipped) => {
		const { backend, request } = setup();
		backend.claim.mockResolvedValue({ skipped });
		expect((await request()).status).toBe(429);
		expect(backend.smtp).not.toHaveBeenCalled();
		expect(backend.send).not.toHaveBeenCalled();
		expect(backend.complete).not.toHaveBeenCalled();
	},
);

it.each(["channel", "claim", "smtp", "complete"] as const)(
	"fails securely when %s throws without leaking diagnostics",
	async (failure) => {
		const { backend, request } = setup();
		backend[failure].mockRejectedValue(new Error("synthetic-secret postgres://internal/db"));
		const response = await request();
		expect(response.status).toBe(failure === "claim" ? 403 : 503);
		expect(await response.text()).not.toMatch(/synthetic-secret|postgres:|internal/);
		if (failure !== "complete") {
			expect(backend.send).not.toHaveBeenCalled();
		}
		if (failure === "smtp") {
			expect(backend.complete).toHaveBeenCalledExactlyOnceWith("server-claim", false);
		}
	},
);
