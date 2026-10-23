import type { SmtpSettings } from "../../domain/repositories/WorkspaceSettingsRepository";

/** 通知メールの送信テスト。宛先は保存しない。 */
export interface NotificationTestGateway {
	/**
	 * 入力された設定で、指定した宛先にサンプル通知を送り、届いたときだけ設定を保存する。
	 * password が空なら、登録済みのものを使う。保存できなかったときは理由を添えて reject する。
	 */
	saveAfterTestMail(settings: SmtpSettings, to: string, templateId: string): Promise<void>;
}
