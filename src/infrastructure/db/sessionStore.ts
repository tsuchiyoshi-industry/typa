/** localStorage / sessionStorage のうち、ここで使う部分。 */
type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;

const isAuthKey = (key: string) => key.startsWith("sb-") && key.includes("-auth-token");

const authKeys = (store: KeyValueStore): string[] =>
	Array.from({ length: store.length }, (_, index) => store.key(index) ?? "").filter(isAuthKey);

/**
 * ログインのセッションの置き場所。
 * 基本は sessionStorage で、アプリを閉じると消える(共有PCで前の人のログインを残さない)。
 * 「ログイン状態を保持する」社員だけ localStorage にも置き、次に開いたときにログインしたままにする。
 * 保持するかどうかは社員マスタで Admin が決め、ログインのたびに keepSignedIn で伝える。
 */
export function createSessionStore(session: KeyValueStore, local: KeyValueStore) {
	// 前回保持したセッションが残っていれば、設定を読み直すまでは保持を続ける
	// (その間に更新されたトークンを localStorage に書かないと、残っているほうが古くなる)
	let keep = authKeys(local).length > 0;

	return {
		storage: {
			getItem: (key: string) => session.getItem(key) ?? local.getItem(key),
			setItem: (key: string, value: string) => {
				session.setItem(key, value);
				if (keep) {
					local.setItem(key, value);
				}
			},
			removeItem: (key: string) => {
				session.removeItem(key);
				local.removeItem(key);
			},
		},
		/** いまのセッションを、保持するなら localStorage に写し、しないなら localStorage から消す。 */
		keepSignedIn(enabled: boolean): void {
			keep = enabled;
			if (enabled) {
				for (const key of authKeys(session)) {
					local.setItem(key, session.getItem(key) ?? "");
				}
				return;
			}
			for (const key of authKeys(local)) {
				// 保持していたセッションで開いた回は、閉じるまでそのまま使える
				if (session.getItem(key) === null) {
					session.setItem(key, local.getItem(key) ?? "");
				}
				local.removeItem(key);
			}
		},
	};
}
