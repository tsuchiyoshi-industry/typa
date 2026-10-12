import { createClient } from "@supabase/supabase-js";
import { createSessionStore } from "./sessionStore";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// 共有PCで前の人のログインが残らないよう、セッションは基本、アプリを閉じると消える場所に置く。
// 社員マスタで「ログイン状態を保持する」になっている社員だけ、次に開いたときのために残す
const sessionStore =
	globalThis.sessionStorage && globalThis.localStorage
		? createSessionStore(globalThis.sessionStorage, globalThis.localStorage)
		: undefined;

export const supabase = createClient(supabaseUrl, supabaseKey, {
	auth: { storage: sessionStore?.storage },
});

/** いまログインしている社員のセッションを、アプリを閉じた後も残すかどうか。 */
export function keepSignedIn(enabled: boolean): void {
	sessionStore?.keepSignedIn(enabled);
}
