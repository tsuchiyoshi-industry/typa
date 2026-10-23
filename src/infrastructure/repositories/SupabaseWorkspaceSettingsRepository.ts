import type {
	NotificationChannel,
	SmtpSettingsSummary,
	WorkspaceSettingsRepository,
} from "../../domain/repositories/WorkspaceSettingsRepository";
import { supabase } from "../db/supabase";

export class SupabaseWorkspaceSettingsRepository implements WorkspaceSettingsRepository {
	async findRequiredDomain(): Promise<string> {
		const { data, error } = await supabase.rpc("get_required_domain");
		if (error) {
			throw error;
		}
		if (typeof data !== "string") {
			throw new Error("会社ドメインの設定が登録されていません。");
		}
		return data;
	}

	async findSmtpSummary(): Promise<SmtpSettingsSummary | null> {
		const { data, error } = await supabase
			.from("workspace_settings")
			.select(
				"smtp_host, smtp_port, smtp_user, smtp_password_set, smtp_verified_at, notification_channel",
			)
			.maybeSingle();

		if (error) {
			throw error;
		}
		const row = data as {
			smtp_host: string;
			smtp_port: number;
			smtp_user: string;
			smtp_password_set: boolean;
			smtp_verified_at: string | null;
			notification_channel: NotificationChannel;
		} | null;
		// Admin 以外には、RLSで行が見えない
		return (
			row && {
				host: row.smtp_host,
				port: row.smtp_port,
				user: row.smtp_user,
				passwordSet: row.smtp_password_set,
				verifiedAt: row.smtp_verified_at,
				channel: row.notification_channel,
			}
		);
	}

	async saveNotificationChannel(channel: NotificationChannel): Promise<boolean> {
		const { data, error } = await supabase
			.from("workspace_settings")
			.update({ notification_channel: channel, updated_at: new Date().toISOString() })
			.eq("id", true)
			.select("id");
		if (error) {
			throw error;
		}
		// RLSで拒否された更新はエラーにならず0件で返る
		return (data?.length ?? 0) > 0;
	}
}
