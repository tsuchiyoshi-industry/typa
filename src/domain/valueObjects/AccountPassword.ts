/**
 * 社員アカウントのパスワードの条件。新規登録・仮のパスワード・本人による変更で共通。
 * DB 関数 reset_employee_password も同じ条件で断る。72 バイトは bcrypt と Supabase Auth の上限
 * (それより長いと Auth が断るか、後ろが無視される)。
 */
export const ACCOUNT_PASSWORD_RULE = "6文字以上で、大文字・小文字・数字をすべて含めてください。";

export const isValidAccountPassword = (password: string): boolean =>
	password.length >= 6 &&
	new TextEncoder().encode(password).length <= 72 &&
	/[a-z]/.test(password) &&
	/[A-Z]/.test(password) &&
	/[0-9]/.test(password);

// 口頭や紙で伝えるので、0/O・1/l/I のような見間違えやすい文字は使わない
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = LOWER + UPPER + DIGITS;

/**
 * Admin が本人に渡す仮のパスワード。10 文字(約 58 ビット)。本人は最初のログインで変えるので、
 * 覚えやすさより、推測されにくさと伝えやすさを取る。偏りが出ないよう、剰余でなく棄却で選ぶ。
 */
export function generateTemporaryPassword(): string {
	const pick = (chars: string) => {
		const limit = 256 - (256 % chars.length);
		const byte = new Uint8Array(1);
		do {
			crypto.getRandomValues(byte);
		} while (byte[0] >= limit);
		return chars[byte[0] % chars.length];
	};
	for (;;) {
		const password = Array.from({ length: 10 }, () => pick(ALL)).join("");
		// 条件を満たさない組み合わせ(数字が無いなど)は引き直す。偏りを作らずに済む
		if (isValidAccountPassword(password)) {
			return password;
		}
	}
}
