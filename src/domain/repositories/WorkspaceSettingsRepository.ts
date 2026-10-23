/** 通知メールの送信に使う SMTP サーバーと、送信元のアカウント。送信はサーバー側で行い、アプリには配らない。 */
export interface SmtpSettings {
	host: string;
	port: number;
	/** 送信元メールアドレス。SMTP のログインにも使う。 */
	user: string;
	password: string;
}

/** 評価の依頼を知らせる方法。アプリ内通知(既定)かメールのどちらか一方。 */
export type NotificationChannel = "in_app" | "email";

/** 設定画面に出す通知の設定。パスワードは読み出さず、登録済みかどうかだけが分かる。 */
export type SmtpSettingsSummary = Omit<SmtpSettings, "password"> & {
	passwordSet: boolean;
	/** 保存されている SMTP 設定で送信テストに成功した日時(ISO 8601)。成功していなければ null。 */
	verifiedAt: string | null;
	channel: NotificationChannel;
};

/** ワークスペース全体で1つの設定。利用者ごとには変わらない。 */
export interface WorkspaceSettingsRepository {
	/** 会社のメールドメイン(例: example.jp)。ログインの前でも読める。 */
	findRequiredDomain(): Promise<string>;
	/** Admin 以外には見えず、null。 */
	findSmtpSummary(): Promise<SmtpSettingsSummary | null>;
	/**
	 * 通知の方法を変える。メールは、送信テストに成功した SMTP 設定があるときだけ選べる(DB の制約)。
	 * Admin 以外の保存は DB 側で拒否される。保存できたら true。
	 */
	saveNotificationChannel(channel: NotificationChannel): Promise<boolean>;
}
