/** 通知メールの送信に使う SMTP サーバーと、送信元のアカウント。 */
export interface SmtpSettings {
	host: string;
	port: number;
	/** 送信元メールアドレス。SMTP のログインにも使う。 */
	user: string;
	password: string;
}

/** 設定画面に出す SMTP 設定。パスワードは読み出さず、登録済みかどうかだけが分かる。 */
export type SmtpSettingsSummary = Omit<SmtpSettings, "password"> & { passwordSet: boolean };

/** ワークスペース全体で1つの設定。利用者ごとには変わらない。 */
export interface WorkspaceSettingsRepository {
	/** 会社のメールドメイン(例: example.jp)。ログインの前でも読める。 */
	findRequiredDomain(): Promise<string>;
	/** 通知メールを送るための SMTP 設定。評価シートの評価者だけが読める。 */
	findNotificationSmtp(): Promise<SmtpSettings>;
	/** Admin 以外には見えず、null。 */
	findSmtpSummary(): Promise<SmtpSettingsSummary | null>;
	/** password が空なら、登録済みのパスワードを残す。Admin 以外の保存はDB側で拒否される。保存できたら true。 */
	saveSmtp(settings: SmtpSettings): Promise<boolean>;
}
