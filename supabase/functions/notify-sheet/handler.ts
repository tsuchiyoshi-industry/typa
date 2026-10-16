import { composeMails, type Delivery, type Mail, type SheetNotification } from "./mail.ts";

export interface SmtpSettings {
	smtp_host: string;
	smtp_port: number;
	smtp_user: string;
	smtp_password: string;
}
export interface NotificationClaim {
	claimId?: string;
	skipped?: "sent" | "finalized" | "cooldown" | "limit" | "rate_limit";
	notification?: SheetNotification;
}
export interface NotificationBackend {
	authenticate(token: string): Promise<string | null>;
	claim(sheetId: number, actor: string): Promise<NotificationClaim>;
	smtp(): Promise<SmtpSettings | null>;
	complete(claimId: string, success: boolean): Promise<void>;
	send(settings: SmtpSettings, mail: Mail): Promise<void>;
}
const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, "Content-Type": "application/json" },
	});
async function bodyJson(request: Request): Promise<unknown> {
	if (!request.body) {
		throw new Error("missing body");
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			size += value.length;
			if (size > 4096) {
				await reader.cancel();
				throw new Error("body too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}

export function createNotificationHandler(backend: NotificationBackend) {
	return async (request: Request): Promise<Response> => {
		if (request.method === "OPTIONS") {
			return new Response("ok", { headers: CORS });
		}
		if (request.method !== "POST") {
			return respond({ error: "POST で送信してください。" }, 405);
		}
		const token = request.headers.get("Authorization")?.replace(/^Bearer /i, "") ?? "";
		const actor = await backend.authenticate(token).catch(() => null);
		if (!actor) {
			return respond({ error: "ログインが必要です。" }, 401);
		}
		let sheetId: unknown;
		try {
			sheetId = ((await bodyJson(request)) as { sheetId?: unknown } | null)?.sheetId;
		} catch {
			return respond({ error: "評価シートを指定してください。" }, 400);
		}
		if (!Number.isSafeInteger(sheetId) || (sheetId as number) <= 0) {
			return respond({ error: "評価シートを指定してください。" }, 400);
		}
		let claim: NotificationClaim;
		try {
			claim = await backend.claim(sheetId as number, actor);
		} catch {
			return respond({ error: "この評価シートの通知を送る権限がありません。" }, 403);
		}
		if (claim.skipped === "finalized") {
			return respond({ deliveries: [] });
		}
		if (claim.skipped === "sent" && claim.notification) {
			const { mails, undeliverable } = composeMails(claim.notification);
			return respond({
				deliveries: [
					...mails.map((mail) => ({ recipient: mail.recipient, alreadySent: true })),
					...undeliverable,
				],
			});
		}
		if (claim.skipped) {
			return respond(
				{
					error:
						claim.skipped === "rate_limit"
							? "短時間に通知が集中しています。10分以上あけて再度お試しください。"
							: claim.skipped === "limit"
								? "再送回数の上限に達しました。管理者に確認してください。"
								: "送信処理中、または再送の待機時間です。1分以上あけて再度お試しください。",
				},
				429,
			);
		}
		if (!claim.claimId || !claim.notification) {
			return respond({ error: "通知を準備できませんでした。" }, 503);
		}
		let success = false;
		let response: Response;
		try {
			const smtp = await backend.smtp();
			if (!smtp?.smtp_host || !smtp.smtp_user) {
				response = respond(
					{ error: "SMTP設定が登録されていません。Admin が設定画面で登録してください。" },
					409,
				);
			} else {
				const { mails, undeliverable } = composeMails(claim.notification);
				const deliveries: Delivery[] = [...undeliverable];
				for (const mail of mails) {
					try {
						await backend.send(smtp, mail);
						deliveries.push({ recipient: mail.recipient });
					} catch {
						deliveries.push({
							recipient: mail.recipient,
							error: "メール送信に失敗しました。SMTP設定と接続先を管理者に確認してください。",
						});
					}
				}
				success = deliveries.length > 0 && deliveries.every((delivery) => !delivery.error);
				response = respond({ deliveries });
			}
		} catch {
			response = respond(
				{ error: "通知メールを送信できませんでした。時間をおいて再送してください。" },
				503,
			);
		}
		try {
			await backend.complete(claim.claimId, success);
		} catch {
			return respond(
				{
					error:
						"送信結果を記録できませんでした。メールが届いているか確認し、5分以上あけてから再送してください。",
				},
				503,
			);
		}
		return response;
	};
}
