/**
 * ログイン後の画面を見せた社員を覚え、その人がサインアウトしたら(または別の人に替わったら)
 * ページを読み直すように伝える。Presenter のビューモデルや Controller の状態は、ページを開いている間
 * 残り続けるので、読み直して前の人の評価を共有PCの次の人に見せない。
 * 読み直すのはサインアウトしたときで、次の人のログイン中(登録直後の社員番号の確認など)は邪魔しない。
 */
export function createAccountSwitchGuard() {
	let shownTo: string | null = null;
	return {
		/** セッションが無くなったときに呼ぶ。true なら、ページを読み直す。 */
		signedOut(): boolean {
			return shownTo !== null;
		},
		/** userId の社員にログイン後の画面を見せる前に呼ぶ。true なら見せずにページを読み直す。 */
		mustReloadFor(userId: string): boolean {
			if (shownTo !== null && shownTo !== userId) {
				return true;
			}
			shownTo = userId;
			return false;
		},
	};
}
