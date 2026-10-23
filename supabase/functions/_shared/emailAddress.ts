/** ヘッダーや複数宛先を受け付けず、メールアドレス1件だけを返す。 */
export function normalizeEmailAddress(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const email = value.trim();
	return email.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(email) ? email : null;
}
