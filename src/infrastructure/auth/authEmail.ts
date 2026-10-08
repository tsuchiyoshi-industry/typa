/**
 * ログインIDは社員番号。Supabase Auth はメールアドレスを要求するため、社員番号から内部用の
 * アドレスを組み立てて渡す。このアドレスにメールが届くことはなく、利用者にも見せない。
 * 会社ドメインが未設定、または社員番号が半角英数字・ハイフン・アンダースコア以外を含むときは null。
 */
export function toAuthEmail(employeeNo: string, requiredDomain: string | undefined): string | null {
	const domain = requiredDomain?.slice(requiredDomain.lastIndexOf("@") + 1);
	if (!domain || !/^[A-Za-z0-9_-]+$/.test(employeeNo)) {
		return null;
	}
	return `typa-${employeeNo.toLowerCase()}@${domain}`;
}
