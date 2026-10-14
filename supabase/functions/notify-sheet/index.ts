// Sends the notification mail for a sheet's current status, to whoever acts next: to the
// primary evaluator when it is submitted, to the secondary evaluator when the primary
// evaluation is confirmed. A finalized sheet has nobody left to act, so nothing is sent.
//
// The app only says which sheet. Who is told, and whether the caller is the person who made
// that status change, is decided by the database (get_sheet_notification). The recipients'
// addresses and the SMTP password never leave the server.
//
// Deploy: npx supabase functions deploy notify-sheet
// SMTP: Supabase Edge Functions cannot open connections to ports 25 and 587. Register the
// mail server's implicit-TLS port (465) in the app's SMTP settings, or 2525 where offered.
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";
import { composeMails, type Delivery, type SheetNotification } from "./mail.ts";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const respond = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, "Content-Type": "application/json" },
	});

Deno.serve(async (request) => {
	if (request.method === "OPTIONS") {
		return new Response("ok", { headers: CORS });
	}

	const admin = createClient(
		Deno.env.get("SUPABASE_URL") ?? "",
		Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
	);
	const token = request.headers.get("Authorization")?.replace(/^Bearer /i, "") ?? "";
	const {
		data: { user },
	} = await admin.auth.getUser(token);
	if (!user) {
		return respond({ error: "ログインが必要です。" }, 401);
	}

	const { sheetId } = await request.json().catch(() => ({}));
	if (!Number.isSafeInteger(sheetId)) {
		return respond({ error: "評価シートを指定してください。" }, 400);
	}

	// ponytail: no rate limit. The actor can re-send the same fixed mail to the same
	// evaluators by calling this again; add a per-sheet "notified at" check if that is abused.
	const { data: notification, error } = await admin.rpc("get_sheet_notification", {
		p_sheet_id: sheetId,
		p_actor: user.id,
	});
	if (error || !notification) {
		return respond({ error: "この評価シートの通知を送る権限がありません。" }, 403);
	}

	// get_sheet_notification still answers for a finalized sheet (older apps ask); send nothing.
	if (notification.status === "finalized") {
		return respond({ deliveries: [] });
	}

	const { data: smtp } = await admin
		.from("workspace_settings")
		.select("smtp_host, smtp_port, smtp_user, smtp_password")
		.maybeSingle();
	if (!smtp?.smtp_host || !smtp.smtp_user) {
		return respond(
			{ error: "SMTP設定が登録されていません。Admin が設定画面で登録してください。" },
			409,
		);
	}

	const transport = nodemailer.createTransport({
		host: smtp.smtp_host,
		port: smtp.smtp_port,
		// 465 speaks TLS from the first byte; any other port must upgrade with STARTTLS.
		secure: smtp.smtp_port === 465,
		requireTLS: true,
		auth: { user: smtp.smtp_user, pass: smtp.smtp_password },
	});

	const { mails, undeliverable } = composeMails(notification as SheetNotification);
	const deliveries: Delivery[] = await Promise.all(
		mails.map(async (mail) => {
			try {
				await transport.sendMail({
					from: smtp.smtp_user,
					to: mail.to,
					subject: mail.subject,
					text: mail.text,
				});
				return { recipient: mail.recipient };
			} catch (cause) {
				console.error("notify-sheet: send failed", cause);
				return {
					recipient: mail.recipient,
					error: `メール送信に失敗しました: ${cause instanceof Error ? cause.message : cause}`,
				};
			}
		}),
	);

	return respond({ deliveries: [...undeliverable, ...deliveries] });
});
