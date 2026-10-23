/**
 * SMTP 設定の入力の誤り。正しければ null。host と user は前後の空白を除いてから渡す。
 * 設定画面(アプリ)と Edge Function の両方で同じ規則を使う。
 */
export function smtpSettingsProblem(host: string, port: unknown, user: string): string | null {
	if (!host || /\s/.test(host)) {
		return "SMTP ホストを入力してください。";
	}
	if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
		return "ポートは 1〜65535 の整数で入力してください。";
	}
	if (!/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(user)) {
		return "送信元メールアドレスを正しく入力してください。";
	}
	return null;
}
