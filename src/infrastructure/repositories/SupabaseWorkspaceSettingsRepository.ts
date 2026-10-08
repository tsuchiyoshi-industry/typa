import type {
	SmtpSettings,
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

	async findNotificationSmtp(): Promise<SmtpSettings> {
		const { data, error } = await supabase.rpc("get_notification_smtp_settings");
		if (error) {
			throw error;
		}
		const row = data as Partial<SmtpSettings> | null;
		if (
			typeof row?.host !== "string" ||
			typeof row.port !== "number" ||
			typeof row.user !== "string" ||
			typeof row.password !== "string"
		) {
			throw new Error("SMTP設定が不正です。");
		}
		return { host: row.host, port: row.port, user: row.user, password: row.password };
	}

	async findSmtpSummary(): Promise<SmtpSettingsSummary | null> {
		const { data, error } = await supabase
			.from("workspace_settings")
			.select("smtp_host, smtp_port, smtp_user, smtp_password_set")
			.maybeSingle();

		if (error) {
			throw error;
		}
		const row = data as {
			smtp_host: string;
			smtp_port: number;
			smtp_user: string;
			smtp_password_set: boolean;
		} | null;
		// Admin 以外には、RLSで行が見えない
		return (
			row && {
				host: row.smtp_host,
				port: row.smtp_port,
				user: row.smtp_user,
				passwordSet: row.smtp_password_set,
			}
		);
	}

	async saveSmtp(settings: SmtpSettings): Promise<boolean> {
		const { data, error } = await supabase
			.from("workspace_settings")
			.update({
				smtp_host: settings.host,
				smtp_port: settings.port,
				smtp_user: settings.user,
				// 空欄なら、登録済みのパスワードを残す
				...(settings.password ? { smtp_password: settings.password } : {}),
				updated_at: new Date().toISOString(),
			})
			.eq("id", true)
			.select("id");

		if (error) {
			throw error;
		}
		// RLSで拒否された更新はエラーにならず0件で返る
		return (data?.length ?? 0) > 0;
	}
}
