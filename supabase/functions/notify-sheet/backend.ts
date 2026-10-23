import { createClient } from "@supabase/supabase-js";
import type { NotificationBackend, NotificationClaim, SmtpSettings } from "./handler.ts";
import { createNotificationTransport } from "./transport.ts";

export function createNotificationBackend(): NotificationBackend {
	const admin = createClient(
		Deno.env.get("SUPABASE_URL") ?? "",
		Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
		{
			auth: { persistSession: false, autoRefreshToken: false },
		},
	);
	return {
		async authenticate(token) {
			const {
				data: { user },
			} = await admin.auth.getUser(token);
			return user?.id ?? null;
		},
		async canSendTest(actor) {
			const { data, error } = await admin
				.from("employees")
				.select("id,roles!inner(role_name)")
				.eq("user_id", actor)
				.eq("is_enabled", true)
				.eq("roles.role_name", "Admin")
				.maybeSingle();
			if (error) {
				throw error;
			}
			return !!data;
		},
		async claim(sheetId, actor) {
			const { data, error } = await admin.rpc("claim_sheet_notification", {
				p_sheet_id: sheetId,
				p_actor: actor,
			});
			if (error) {
				throw error;
			}
			return data as NotificationClaim;
		},
		async smtp() {
			const { data, error } = await admin
				.from("workspace_settings")
				.select("smtp_host,smtp_port,smtp_user,smtp_password")
				.maybeSingle();
			if (error) {
				throw error;
			}
			return data as SmtpSettings | null;
		},
		async channel() {
			const { data, error } = await admin
				.from("workspace_settings")
				.select("notification_channel")
				.single();
			if (error) {
				throw error;
			}
			return data.notification_channel as string;
		},
		async saveSmtp(smtp) {
			const now = new Date().toISOString();
			const { data, error } = await admin
				.from("workspace_settings")
				.update({ ...smtp, smtp_verified_at: now, updated_at: now })
				.eq("id", true)
				.select("id");
			if (error || data?.length !== 1) {
				throw error ?? new Error("Workspace settings row is missing");
			}
		},
		async complete(claimId, success) {
			const { data, error } = await admin.rpc("complete_sheet_notification", {
				p_claim_id: claimId,
				p_success: success,
			});
			if (error || data !== true) {
				throw error ?? new Error("Delivery claim expired");
			}
		},
		async send(smtp, mail) {
			const transport = createNotificationTransport(smtp);
			try {
				await transport.sendMail({
					from: smtp.smtp_user,
					to: mail.to,
					subject: mail.subject,
					text: mail.text,
				});
			} finally {
				transport.close();
			}
		},
	};
}
