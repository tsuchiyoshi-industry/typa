import { normalizeEmailAddress } from "../_shared/emailAddress.ts";
import { isNotificationTemplateId } from "../_shared/notificationTemplates.ts";
import { smtpSettingsProblem } from "../_shared/smtpSettings.ts";
import {
	composeMails,
	composeTestMail,
	type Delivery,
	type Mail,
	type SheetNotification,
} from "./mail.ts";

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
	canSendTest(actor: string): Promise<boolean>;
	claim(sheetId: number, actor: string): Promise<NotificationClaim>;
	smtp(): Promise<SmtpSettings | null>;
	complete(claimId: string, success: boolean): Promise<void>;
	send(settings: SmtpSettings, mail: Mail): Promise<void>;
	/** 送信テストに成功した設定を保存し、確認済みにする。 */
	saveSmtp(settings: SmtpSettings): Promise<void>;
	/** 評価の依頼を知らせる方法。"email" のときだけメールを送る。 */
	channel(): Promise<string>;
}

/** 入力された SMTP 設定。正しくなければ、直してほしいことを返す。 */
function parseSmtpSettings(value: unknown): SmtpSettings | string {
	const { host, port, user, password } = (
		value && typeof value === "object" && !Array.isArray(value) ? value : {}
	) as Record<string, unknown>;
	const smtpHost = typeof host === "string" ? host.trim() : "";
	const smtpUser = typeof user === "string" ? user.trim() : "";
	const problem = smtpSettingsProblem(smtpHost, port, smtpUser);
	if (problem) {
		return problem;
	}
	if (typeof password !== "string") {
		return "パスワードを入力してください。";
	}
	return {
		smtp_host: smtpHost,
		smtp_port: port as number,
		smtp_user: smtpUser,
		smtp_password: password,
	};
}

/** 有効な Admin でなければ、断る応答を返す。 */
async function refuseNonAdmin(
	backend: NotificationBackend,
	actor: string,
): Promise<Response | null> {
	try {
		return (await backend.canSendTest(actor))
			? null
			: respond({ error: "送信テストは Admin のみ利用できます。" }, 403);
	} catch {
		return respond({ error: "送信テストの権限を確認できませんでした。" }, 503);
	}
}

/** パスワードが空欄なら登録済みのものを使う。ただし別のサーバー・アカウントへは渡さない。 */
async function withStoredPassword(
	backend: NotificationBackend,
	settings: SmtpSettings,
): Promise<SmtpSettings | Response> {
	if (settings.smtp_password) {
		return settings;
	}
	let stored: SmtpSettings | null;
	try {
		stored = await backend.smtp();
	} catch {
		return respond({ error: "登録済みの通知メールの設定を読み込めませんでした。" }, 503);
	}
	const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
	if (
		!stored?.smtp_password ||
		!same(stored.smtp_host, settings.smtp_host) ||
		!same(stored.smtp_user, settings.smtp_user)
	) {
		return respond(
			{
				error:
					"パスワードを入力してください。SMTP ホストか送信元メールアドレスを変えるときは、パスワードも入力し直してください。",
			},
			400,
		);
	}
	return { ...settings, smtp_password: stored.smtp_password };
}

async function saveSmtpSettings(
	backend: NotificationBackend,
	actor: string,
	body: Record<string, unknown>,
): Promise<Response> {
	const denied = await refuseNonAdmin(backend, actor);
	if (denied) {
		return denied;
	}
	const to = normalizeEmailAddress(body.to);
	if (!to) {
		return respond({ error: "宛先メールアドレスを1件入力してください。" }, 400);
	}
	if (!isNotificationTemplateId(body.templateId)) {
		return respond({ error: "送信する通知パターンを選んでください。" }, 400);
	}
	const settings = parseSmtpSettings(body.smtp);
	if (typeof settings === "string") {
		return respond({ error: settings }, 400);
	}
	const complete = await withStoredPassword(backend, settings);
	if (complete instanceof Response) {
		return complete;
	}
	try {
		await backend.send(complete, composeTestMail(body.templateId, to));
	} catch (error) {
		return testMailFailed(error, complete.smtp_password);
	}
	try {
		await backend.saveSmtp(complete);
	} catch {
		return respond(
			{
				error:
					"テストメールは送信しましたが、設定を保存できませんでした。時間をおいて、もう一度保存してください。",
			},
			503,
		);
	}
	return respond({ success: true });
}

/** 送信テストは Admin だけが使う。原因を直せるよう SMTP の応答を見せ、パスワードだけは伏せる。 */
function testMailFailed(error: unknown, password?: string): Response {
	return respond(
		{
			error: `テストメールを送信できませんでした。SMTP設定と接続先を確認してください。（詳細: ${errorDetail(error, password)}）`,
		},
		503,
	);
}

function errorDetail(error: unknown, secret?: string): string {
	const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
	let detail = typeof message === "string" && message ? message : String(error);
	if (typeof code === "string" && !detail.includes(code)) {
		detail = `${code}: ${detail}`;
	}
	if (secret) {
		detail = detail.split(secret).join("********");
	}
	return detail.slice(0, 300);
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
		let body: unknown;
		try {
			body = await bodyJson(request);
		} catch {
			return respond({ error: "評価シートを指定してください。" }, 400);
		}
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return respond({ error: "送信内容を確認してください。" }, 400);
		}
		const input = body as Record<string, unknown>;
		if (input.mode === "save") {
			return saveSmtpSettings(backend, actor, input);
		}
		if (input.mode !== undefined) {
			return respond({ error: "送信内容を確認してください。" }, 400);
		}
		const sheetId = input.sheetId;
		if (!Number.isSafeInteger(sheetId) || (sheetId as number) <= 0) {
			return respond({ error: "評価シートを指定してください。" }, 400);
		}
		// アプリ内通知のときは、状態の変更と同時に DB が通知を作る。メールは送らない
		let channel: string;
		try {
			channel = await backend.channel();
		} catch {
			return respond(
				{ error: "通知の設定を読み込めませんでした。時間をおいて再送してください。" },
				503,
			);
		}
		if (channel !== "email") {
			return respond({ deliveries: [] });
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
